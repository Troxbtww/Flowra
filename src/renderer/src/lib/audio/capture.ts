import { AudioSegment, TrackType, VadDiagnostics, VadState } from '../types'
import { UtteranceBuilder } from '../vad/utterance-builder'

export interface TrackMetadata {
  trackType: TrackType
  label?: string
  sampleRate?: number
  channelCount?: number
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
  settings: MediaTrackSettings
}

export interface AudioSessionStartResult {
  sessionId: string
  startedAt: number
  availableTracks: TrackType[]
  trackMetadata: TrackMetadata[]
  warnings: string[]
}

export interface AudioSessionPipelineHandlers {
  onSegment?: (segment: AudioSegment) => void
  onSegmentRejected?: (segment: AudioSegment, reason: string) => void
  onVadDiagnostics?: (diagnostics: VadDiagnostics) => void
  onCaptureWarning?: (warning: string) => void
}

interface TrackPipeline {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  highpass: BiquadFilterNode
  vadNode: AudioWorkletNode
  utteranceBuilder: UtteranceBuilder
  metadata: TrackMetadata
}

export class AudioSessionPipeline {
  private static workletLoaded = false

  private readonly sessionId: string
  private handlers: AudioSessionPipelineHandlers
  private audioContext: AudioContext | null = null

  private micPipeline: TrackPipeline | null = null
  private systemPipeline: TrackPipeline | null = null
  private displayStream: MediaStream | null = null
  private _isPaused = false

  constructor(sessionId: string, handlers: AudioSessionPipelineHandlers = {}) {
    this.sessionId = sessionId
    this.handlers = handlers
  }

  public setHandlers(handlers: AudioSessionPipelineHandlers) {
    this.handlers = handlers
  }

  public async startSession(): Promise<AudioSessionStartResult> {
    const warnings: string[] = []
    this.audioContext = new AudioContext()

    await this.loadWorkletModule(this.audioContext)

    let micStream: MediaStream | null = null
    let systemStream: MediaStream | null = null

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      })
    } catch (error) {
      const warning = `Microphone unavailable: ${String(error)}`
      warnings.push(warning)
      this.handlers.onCaptureWarning?.(warning)
    }

    try {
      this.displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      })
      this.displayStream.getVideoTracks().forEach((track) => track.stop())
      const audioTracks = this.displayStream.getAudioTracks()
      if (audioTracks.length > 0) {
        systemStream = new MediaStream(audioTracks)
      } else {
        const warning = 'System audio track was not provided by display capture.'
        warnings.push(warning)
        this.handlers.onCaptureWarning?.(warning)
      }
    } catch (error) {
      const warning = `System audio unavailable: ${String(error)}`
      warnings.push(warning)
      this.handlers.onCaptureWarning?.(warning)
    }

    if (!micStream && !systemStream) {
      throw new Error('Unable to start Live Assist: no audio tracks were captured.')
    }

    if (!this.audioContext) {
      throw new Error('Audio context was not initialized.')
    }

    const availableTracks: TrackType[] = []
    const trackMetadata: TrackMetadata[] = []

    if (micStream) {
      this.micPipeline = this.createTrackPipeline('mic', micStream, this.audioContext)
      availableTracks.push('mic')
      trackMetadata.push(this.micPipeline.metadata)
    }

    if (systemStream) {
      this.systemPipeline = this.createTrackPipeline('system', systemStream, this.audioContext)
      availableTracks.push('system')
      trackMetadata.push(this.systemPipeline.metadata)
    }

    return {
      sessionId: this.sessionId,
      startedAt: Date.now(),
      availableTracks,
      trackMetadata,
      warnings
    }
  }

  public async stopSession() {
    this.disposePipeline(this.micPipeline)
    this.disposePipeline(this.systemPipeline)
    this.micPipeline = null
    this.systemPipeline = null

    if (this.displayStream) {
      this.displayStream.getTracks().forEach((track) => track.stop())
      this.displayStream = null
    }

    if (this.audioContext) {
      await this.audioContext.close().catch(() => undefined)
      this.audioContext = null
    }
  }

  /** Suspend audio processing without destroying streams or session state. */
  public async pauseSession(): Promise<void> {
    this._isPaused = true
    this.micPipeline?.stream.getAudioTracks().forEach((t) => (t.enabled = false))
    this.systemPipeline?.stream.getAudioTracks().forEach((t) => (t.enabled = false))
    if (this.audioContext && this.audioContext.state === 'running') {
      await this.audioContext.suspend()
    }
  }

  /** Resume audio processing after a pause. */
  public async resumeSession(): Promise<void> {
    this._isPaused = false
    this.micPipeline?.stream.getAudioTracks().forEach((t) => (t.enabled = true))
    this.systemPipeline?.stream.getAudioTracks().forEach((t) => (t.enabled = true))
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }
  }

  /** Whether the pipeline is currently paused. */
  public get isPaused(): boolean {
    return this._isPaused
  }

  private async loadWorkletModule(audioContext: AudioContext) {
    if (AudioSessionPipeline.workletLoaded) return
    const workletUrl = new URL('../vad/vad-processor.worklet.js', import.meta.url).href
    await audioContext.audioWorklet.addModule(workletUrl)
    AudioSessionPipeline.workletLoaded = true
  }

  private createTrackPipeline(trackType: TrackType, stream: MediaStream, audioContext: AudioContext): TrackPipeline {
    const source = audioContext.createMediaStreamSource(stream)

    const highpass = audioContext.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 80

    const vadNode = new AudioWorkletNode(audioContext, 'vad-processor', {
      processorOptions: {
        sessionId: this.sessionId,
        trackType
      }
    })

    source.connect(highpass)
    highpass.connect(vadNode)

    const utteranceBuilder = new UtteranceBuilder(this.sessionId, trackType, audioContext.sampleRate)
    utteranceBuilder.onUtteranceFinalized = (segment) => this.handlers.onSegment?.(segment)
    utteranceBuilder.onUtteranceRejected = (segment, reason) => this.handlers.onSegmentRejected?.(segment, reason)

    const clockOffsetMs = Date.now() - audioContext.currentTime * 1000

    vadNode.port.onmessage = (event) => {
      if (this._isPaused) return
      const payload = event.data as {
        type: string
        data?: Float32Array
        rms?: number
        state?: VadState
        noiseFloor?: number
        startThreshold?: number
        stopThreshold?: number
        timestampMs?: number
      }

      const wallClockMs =
        typeof payload.timestampMs === 'number'
          ? Math.round(clockOffsetMs + payload.timestampMs)
          : Date.now()

      if (payload.type === 'frame' && payload.data && typeof payload.rms === 'number') {
        utteranceBuilder.pushFrame(payload.data, payload.rms, {
          noiseFloor: payload.noiseFloor,
          startThreshold: payload.startThreshold,
          stopThreshold: payload.stopThreshold,
          timestampMs: wallClockMs
        })
        return
      }

      if (payload.type === 'speech_start') {
        utteranceBuilder.startUtterance(wallClockMs)
        return
      }

      if (payload.type === 'speech_end') {
        utteranceBuilder.endUtterance('speech_end')
        return
      }

      if (payload.type === 'state' || payload.type === 'noise_floor') {
        this.handlers.onVadDiagnostics?.({
          trackType,
          state: payload.state ?? 'IDLE',
          rms: payload.rms ?? 0,
          noiseFloor: payload.noiseFloor ?? 0,
          startThreshold: payload.startThreshold ?? 0,
          stopThreshold: payload.stopThreshold ?? 0,
          timestampMs: wallClockMs
        })
      }
    }

    const [track] = stream.getAudioTracks()
    const settings = track?.getSettings?.() ?? {}

    return {
      stream,
      source,
      highpass,
      vadNode,
      utteranceBuilder,
      metadata: {
        trackType,
        label: track?.label,
        sampleRate: settings.sampleRate,
        channelCount: settings.channelCount,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
        settings
      }
    }
  }

  private disposePipeline(pipeline: TrackPipeline | null) {
    if (!pipeline) return
    pipeline.vadNode.port.onmessage = null
    pipeline.vadNode.disconnect()
    pipeline.highpass.disconnect()
    pipeline.source.disconnect()
    pipeline.stream.getTracks().forEach((track) => track.stop())
  }
}
