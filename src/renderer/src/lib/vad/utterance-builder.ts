import { AudioSegment, TrackType } from '../types'

/**
 * UtteranceBuilder collects chunks of spoken audio from the track pipeline using VAD signals.
 * Maintains a rolling 250ms preroll buffer to avoid clipping beginnings.
 */

const PREROLL_MS = 250
const MIN_SPEECH_MS = 300
const MAX_UTTERANCE_MS = 8000

interface FrameMeta {
  noiseFloor?: number
  startThreshold?: number
  stopThreshold?: number
  timestampMs?: number
}

export class UtteranceBuilder {
  private sessionId: string
  private trackType: TrackType
  
  private prerollBuffer: Float32Array[] = []
  private activeUtterance: Float32Array[] = []
  private frameSampleSize = 0
  
  private isRecording = false
  private startTime = 0
  private sampleRate = 48000
  private noiseFloor = 0.001
  private startThreshold = 0.0012
  private stopThreshold = 0.0006

  private lastObservedRms = 0
  
  public onUtteranceFinalized: (segment: AudioSegment) => void = () => {}
  public onUtteranceRejected: (segment: AudioSegment, reason: string) => void = () => {}

  constructor(sessionId: string, trackType: TrackType, sampleRate = 48000) {
    this.sessionId = sessionId
    this.trackType = trackType
    this.sampleRate = sampleRate
  }

  public pushFrame(data: Float32Array, rms: number, meta: FrameMeta = {}) {
    this.lastObservedRms = rms
    this.frameSampleSize = data.length
    if (typeof meta.noiseFloor === 'number') this.noiseFloor = meta.noiseFloor
    if (typeof meta.startThreshold === 'number') this.startThreshold = meta.startThreshold
    if (typeof meta.stopThreshold === 'number') this.stopThreshold = meta.stopThreshold

    // Worklet arrays may be reused; clone to avoid data mutation across frames.
    const frame = data.slice(0)

    if (this.isRecording) {
      this.activeUtterance.push(frame)
      
      const currentDurationMs = this.estimateDurationMs(this.activeUtterance)
      if (currentDurationMs >= MAX_UTTERANCE_MS) {
        this.endUtterance('max_utterance')
      }
    } else {
      this.prerollBuffer.push(frame)
      const bufferDurationMs = this.estimateDurationMs(this.prerollBuffer)
      if (bufferDurationMs > PREROLL_MS) {
        this.prerollBuffer.shift()
      }
    }
  }

  public startUtterance(timestampMs = Date.now()) {
    if (this.isRecording) return
    this.isRecording = true
    this.activeUtterance = [...this.prerollBuffer]
    this.startTime = timestampMs - PREROLL_MS
  }

  public endUtterance(_reason = 'speech_end') {
    if (!this.isRecording) return
    this.isRecording = false
    
    const totalSamples = this.totalSamples(this.activeUtterance)
    const durationMs = this.samplesToMs(totalSamples)

    const baseSegment = this.createBaseSegment(durationMs, totalSamples)

    if (!this.validateRawAudio(totalSamples, durationMs)) {
      this.onUtteranceRejected(baseSegment, 'validation_failed')
      this.activeUtterance = []
      return
    }
    
    if (durationMs < MIN_SPEECH_MS) {
      this.onUtteranceRejected(baseSegment, 'validation_failed')
      this.activeUtterance = []
      return
    }
    
    const merged = new Float32Array(totalSamples)
    let offset = 0
    let sumSq = 0
    let peak = 0
    for (const arr of this.activeUtterance) {
      merged.set(arr, offset)
      for (let i = 0; i < arr.length; i++) {
        sumSq += arr[i] * arr[i]
        if (Math.abs(arr[i]) > peak) peak = Math.abs(arr[i])
      }
      offset += arr.length
    }
    
    const avgRms = Math.sqrt(sumSq / totalSamples)

    if (avgRms <= Math.max(0.00045, this.stopThreshold * 0.6)) {
      this.onUtteranceRejected(
        {
          ...baseSegment,
          avgRms,
          peakRms: peak,
          valid: false
        },
        'validation_failed'
      )
      this.activeUtterance = []
      return
    }

    const audioBlob = this.encodeWAV(merged, this.sampleRate)
    if (!audioBlob || audioBlob.size < 800) {
      this.onUtteranceRejected(
        {
          ...baseSegment,
          avgRms,
          peakRms: peak,
          valid: false
        },
        'corrupt_audio'
      )
      this.activeUtterance = []
      return
    }

    const payloadHash = this.hashSamples(merged)
    
    const segment: AudioSegment = {
      ...baseSegment,
      avgRms,
      peakRms: peak,
      noiseFloor: this.noiseFloor,
      startThreshold: this.startThreshold,
      stopThreshold: this.stopThreshold,
      sampleCount: totalSamples,
      payloadHash,
      valid: true,
      audioBlob
    }
    
    this.onUtteranceFinalized(segment)
    this.activeUtterance = []
  }

  private createBaseSegment(durationMs: number, sampleCount: number): AudioSegment {
    return {
      sessionId: this.sessionId,
      segmentId: crypto.randomUUID(),
      trackType: this.trackType,
      startTime: this.startTime,
      endTime: Date.now(),
      durationMs,
      avgRms: this.lastObservedRms,
      peakRms: this.lastObservedRms,
      noiseFloor: this.noiseFloor,
      startThreshold: this.startThreshold,
      stopThreshold: this.stopThreshold,
      sampleCount,
      valid: false
    }
  }

  private validateRawAudio(totalSamples: number, durationMs: number): boolean {
    if (totalSamples <= 0) return false
    if (durationMs < MIN_SPEECH_MS) return false
    if (!Number.isFinite(totalSamples) || !Number.isFinite(durationMs)) return false
    return true
  }

  private totalSamples(frames: Float32Array[]): number {
    return frames.reduce((acc, frame) => acc + frame.length, 0)
  }

  private samplesToMs(samples: number): number {
    return samples / (this.sampleRate / 1000)
  }

  private estimateDurationMs(frames: Float32Array[]): number {
    return this.samplesToMs(this.totalSamples(frames))
  }

  private hashSamples(samples: Float32Array): string {
    let hash = 2166136261
    for (let i = 0; i < samples.length; i++) {
      const value = Math.floor(Math.max(-1, Math.min(1, samples[i])) * 32767)
      hash ^= value
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    }
    return `fnv-${(hash >>> 0).toString(16)}`
  }

  // Basic WAV Encoding Helper
  private encodeWAV(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(buffer)
    
    const writeString = (v: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        v.setUint8(offset + i, string.charCodeAt(i))
      }
    }
    
    writeString(view, 0, 'RIFF')
    view.setUint32(4, 36 + samples.length * 2, true)
    writeString(view, 8, 'WAVE')
    writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // Mono
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeString(view, 36, 'data')
    view.setUint32(40, samples.length * 2, true)
    
    let offset = 44
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    }
    
    return new Blob([buffer], { type: 'audio/wav' })
  }
}
