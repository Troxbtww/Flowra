import { AudioSessionPipeline } from '../audio/capture'
import {
  AudioSegment,
  GuardrailResult,
  LiveInsightData,
  LiveInsightRecord,
  LiveSessionExport,
  LiveSessionTelemetry,
  LiveTurn,
  SegmentOutcome,
  SegmentOutcomeState,
  VadDiagnostics
} from '../types'
import { createTranscriptGuardrails } from '../transcription/guardrails'
import { SessionTimeline } from '../transcription/timeline'

const LIVE_ASSIST_CONFIG = {
  repeatWindowSize: 5,
  repeatCooldownMs: 8000,
  mergeGapMs: 400,
  liveInsightCooldownMs: 3000
}

interface LiveAssistControllerHandlers {
  onTurn?: (turn: LiveTurn) => void
  onInsight?: (insight: LiveInsightData) => void
  onSegmentOutcome?: (outcome: SegmentOutcome) => void
  onVadDiagnostics?: (diagnostics: VadDiagnostics) => void
  onStatus?: (message: string) => void
}

function createTelemetry(): LiveSessionTelemetry {
  return {
    speechStarts: 0,
    finalizedSegments: 0,
    acceptedSegments: 0,
    rejectedSegments: 0,
    rejectedByReason: {},
    transcriptionFailures: 0,
    providerFailures: 0
  }
}

function mapGuardrailReason(result: GuardrailResult): SegmentOutcomeState {
  if (result.reason === 'silence') return 'rejected_silence'
  if (result.reason === 'blacklist') return 'rejected_blacklist'
  if (result.reason === 'repeat') return 'rejected_repeat'
  if (result.reason === 'invalid_length') return 'rejected_invalid_length'
  if (result.reason === 'corrupt_audio') return 'rejected_corrupt_audio'
  if (result.reason === 'tentative') return 'tentative'
  if (result.reason === 'empty' || result.reason === 'no_transcript') return 'rejected_empty'
  return 'rejected_validation'
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result as string
      resolve(dataUrl.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export class LiveAssistController {
  private readonly sessionId: string
  private readonly timeline: SessionTimeline
  private readonly validateTranscript = createTranscriptGuardrails({
    repeatWindowSize: LIVE_ASSIST_CONFIG.repeatWindowSize,
    repeatCooldownMs: LIVE_ASSIST_CONFIG.repeatCooldownMs
  })

  private handlers: LiveAssistControllerHandlers
  private pipeline: AudioSessionPipeline | null = null
  private stopped = false

  private startedAt = 0
  private endedAt = 0
  private telemetry: LiveSessionTelemetry = createTelemetry()
  private rejectedSegments: SegmentOutcome[] = []
  private insightsShown: LiveInsightRecord[] = []
  private lastVadState: Record<'mic' | 'system', string> = {
    mic: 'CALIBRATING',
    system: 'CALIBRATING'
  }

  constructor(handlers: LiveAssistControllerHandlers = {}) {
    this.sessionId = crypto.randomUUID()
    this.handlers = handlers
    this.timeline = new SessionTimeline({
      mergeGapMs: LIVE_ASSIST_CONFIG.mergeGapMs,
      insightCooldownMs: LIVE_ASSIST_CONFIG.liveInsightCooldownMs
    })

    this.timeline.onNewTurn = (turn) => this.handlers.onTurn?.(turn)
    this.timeline.onLiveInsight = (insight) => {
      this.insightsShown.push({ displayedAt: Date.now(), insight })
      this.handlers.onInsight?.(insight)
    }
  }

  public setHandlers(handlers: LiveAssistControllerHandlers) {
    this.handlers = handlers
    this.timeline.onNewTurn = (turn) => this.handlers.onTurn?.(turn)
    this.timeline.onLiveInsight = (insight) => {
      this.insightsShown.push({ displayedAt: Date.now(), insight })
      this.handlers.onInsight?.(insight)
    }
  }

  public async start() {
    this.startedAt = Date.now()
    this.telemetry = createTelemetry()
    this.rejectedSegments = []
    this.insightsShown = []

    this.pipeline = new AudioSessionPipeline(this.sessionId, {
      onSegment: (segment) => {
        if (this.stopped) return
        void this.handleSegment(segment)
      },
      onSegmentRejected: (segment, reason) => {
        if (this.stopped) return
        this.recordRejectedSegment(segment, reason === 'corrupt_audio' ? 'rejected_corrupt_audio' : 'rejected_validation', reason)
      },
      onVadDiagnostics: (diagnostics) => {
        this.trackSpeechStarts(diagnostics)
        this.handlers.onVadDiagnostics?.(diagnostics)
      },
      onCaptureWarning: (warning) => this.handlers.onStatus?.(warning)
    })

    const result = await this.pipeline.startSession()
    this.handlers.onStatus?.('Live Assist v2 active: adaptive VAD + utterance segmentation running.')
    return result
  }

  public async stop(): Promise<LiveSessionExport> {
    // Set stopped flag IMMEDIATELY (synchronously) to prevent any
    // in-flight or queued handleSegment calls from making new API requests
    this.stopped = true
    this.endedAt = Date.now()

    // Abort any pending transcriptions in the main process
    await window.flowraAPI.abortSession(this.sessionId).catch(console.error)

    if (this.pipeline) {
      await this.pipeline.stopSession()
      this.pipeline = null
    }

    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      acceptedTurns: this.timeline.getTurns(),
      rejectedSegments: this.rejectedSegments,
      insightsShown: this.insightsShown,
      telemetry: this.telemetry
    }
  }

  public getTranscriptText(): string {
    return this.timeline.getFullTranscript()
  }

  /** Pause audio capture without destroying the session. Timeline stays intact. */
  public async pause(): Promise<void> {
    if (this.pipeline) {
      await this.pipeline.pauseSession()
      this.handlers.onStatus?.('Session paused – press Ctrl+Y to resume')
    }
  }

  /** Resume audio capture after a pause. Same session, same timeline. */
  public async resume(): Promise<void> {
    if (this.pipeline) {
      await this.pipeline.resumeSession()
      this.handlers.onStatus?.('Recording resumed')
    }
  }

  /** Whether the pipeline is currently paused. */
  public get isPaused(): boolean {
    return this.pipeline?.isPaused ?? false
  }

  private trackSpeechStarts(diagnostics: VadDiagnostics) {
    const track = diagnostics.trackType
    if (this.lastVadState[track] !== 'IN_SPEECH' && diagnostics.state === 'IN_SPEECH') {
      this.telemetry.speechStarts += 1
    }
    this.lastVadState[track] = diagnostics.state
  }

  private async handleSegment(segment: AudioSegment) {
    if (this.stopped) return

    this.telemetry.finalizedSegments += 1

    if (!segment.valid || !segment.audioBlob || segment.audioBlob.size < 800) {
      this.recordRejectedSegment(segment, 'rejected_corrupt_audio', 'invalid audio payload')
      return
    }

    if (!segment.sampleCount || segment.sampleCount <= 0 || segment.durationMs < 300) {
      this.recordRejectedSegment(segment, 'rejected_validation', 'segment validation failed')
      return
    }

    let transcriptionResult:
      | {
          success: boolean
          data?: { segments: Array<{ speaker: string; text: string }>; provider?: string; confidence?: number }
          error?: string
        }
      | undefined

    try {
      const base64Audio = await blobToBase64(segment.audioBlob)
      transcriptionResult = await window.flowraAPI.transcribeAudio(base64Audio, 'audio/wav', {
        sessionId: segment.sessionId,
        segmentId: segment.segmentId,
        trackType: segment.trackType,
        durationMs: segment.durationMs,
        payloadHash: segment.payloadHash,
        languageHint: 'en'
      })
    } catch (error) {
      if (this.stopped) return
      this.telemetry.transcriptionFailures += 1
      this.recordRejectedSegment(segment, 'transcription_failed', String(error))
      return
    }

    // Session was stopped while transcription was in-flight — discard result
    if (this.stopped) return

    if (!transcriptionResult?.success) {
      this.telemetry.transcriptionFailures += 1
      this.telemetry.providerFailures += 1
      this.recordRejectedSegment(segment, 'transcription_failed', transcriptionResult?.error ?? 'transcription failed')
      return
    }

    const segments = transcriptionResult.data?.segments ?? []
    if (segments.length === 0) {
      this.recordRejectedSegment(segment, 'rejected_silence', 'no transcript')
      return
    }

    const combinedText = segments
      .map((entry) => entry.text)
      .join(' ')
      .trim()

    const guardrail = this.validateTranscript(segment, combinedText, transcriptionResult.data?.confidence)
    if (!guardrail.accepted) {
      this.recordRejectedSegment(segment, mapGuardrailReason(guardrail), guardrail.reason ?? 'guardrail rejected', guardrail.text)
      return
    }

    this.telemetry.acceptedSegments += 1

    this.timeline.addTurn(
      segment,
      guardrail.text ?? combinedText,
      transcriptionResult.data?.provider ?? 'openrouter'
    )

    const acceptedOutcome: SegmentOutcome = {
      sessionId: segment.sessionId,
      segmentId: segment.segmentId,
      trackType: segment.trackType,
      state: 'accepted',
      text: guardrail.text ?? combinedText,
      provider: transcriptionResult.data?.provider,
      durationMs: segment.durationMs,
      avgRms: segment.avgRms,
      peakRms: segment.peakRms,
      payloadHash: segment.payloadHash,
      timestampMs: Date.now()
    }
    this.handlers.onSegmentOutcome?.(acceptedOutcome)
  }

  private recordRejectedSegment(segment: AudioSegment, state: SegmentOutcomeState, reason: string, text?: string) {
    if (state !== 'accepted') {
      this.telemetry.rejectedSegments += 1
      this.telemetry.rejectedByReason[state] = (this.telemetry.rejectedByReason[state] ?? 0) + 1
    }

    const outcome: SegmentOutcome = {
      sessionId: segment.sessionId,
      segmentId: segment.segmentId,
      trackType: segment.trackType,
      state,
      reason,
      text,
      durationMs: segment.durationMs,
      avgRms: segment.avgRms,
      peakRms: segment.peakRms,
      payloadHash: segment.payloadHash,
      timestampMs: Date.now()
    }

    this.rejectedSegments.push(outcome)
    this.handlers.onSegmentOutcome?.(outcome)
  }
}
