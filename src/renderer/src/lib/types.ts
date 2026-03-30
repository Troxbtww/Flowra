export interface Scores {
  clarity: number
  emotional_control: number
  conflict_handling: number
  listening?: number
  persuasion?: number
  alignment?: number
}

export interface Alternative {
  text: string
  explanation: string
  predicted_outcome: string
}

export interface Turn {
  turn_index: number
  speaker: string
  content: string
  emotional_tone: string
  intent: string
  hidden_meaning: string | null
  tension_level: number
  category: CategoryType
  is_key_moment: boolean
  explanation: string
  alternatives: Alternative[]
}

export type CategoryType =
  | 'Best'
  | 'Strong'
  | 'Good'
  | 'Unclear'
  | 'Missed Opportunity'
  | 'Risky'
  | 'Misread Signal'
  | 'Escalation'
  | 'Blunder'

export interface AnalysisResult {
  summary: string
  overall_score: number
  scores: Scores
  turns: Turn[]
  category_counts: Record<string, number>
  turn_count: number
}

export interface Conversation {
  id: string
  raw_text: string
  title: string | null
  created_at: string
  overall_score: number
  scores: Scores
  category_counts: Record<string, number>
  summary: string
  turn_count: number
}

export interface DBTurn {
  id: string
  conversation_id: string
  turn_index: number
  speaker: string
  content: string
  emotional_tone: string
  intent: string
  hidden_meaning: string | null
  tension_level: number
  category: CategoryType
  is_key_moment: boolean
  explanation: string
  alternatives: Alternative[]
}

export interface PracticeFeedback {
  score: number
  improvement: string
  still_missing: string | null
  predicted_outcome: string
  tone_assessment: string
}

export interface StyleVariant {
  text: string
  effect: string
}

export interface ResponseStyles {
  calm: StyleVariant
  direct: StyleVariant
  diplomatic: StyleVariant
}

export interface LiveInsightData {
  emotional_tone: string
  intent: string
  hidden_meaning: string | null
  /** Plain-language meaning for quick panel (API may return or we derive) */
  meaning?: string | null
  tension_level: number
  suggestion: string
  alert: string | null
}

export type LiveSessionState = 'idle' | 'recording' | 'paused' | 'ending'

export type TrackType = 'mic' | 'system'

export type VadState = 'CALIBRATING' | 'IDLE' | 'PRE_SPEECH' | 'IN_SPEECH' | 'POST_SPEECH'

export interface VadDiagnostics {
  trackType: TrackType
  state: VadState
  rms: number
  noiseFloor: number
  startThreshold: number
  stopThreshold: number
  timestampMs: number
}

export interface TranscribeAudioMeta {
  sessionId: string
  segmentId: string
  trackType: TrackType
  durationMs: number
  payloadHash?: string
  languageHint?: string
  providerHint?: string
}

export interface TranscriptionProvider {
  name: string
  transcribe(input: {
    segmentId: string
    sessionId?: string
    trackType?: TrackType
    durationMs?: number
    payloadHash?: string
    audio: Blob | ArrayBuffer
    format: string
    languageHint?: string
  }): Promise<{
    text: string
    confidence?: number
    raw?: unknown
  }>
}

export interface AudioSegment {
  sessionId: string
  segmentId: string
  trackType: TrackType
  startTime: number
  endTime: number
  durationMs: number
  avgRms: number
  peakRms: number
  noiseFloor: number
  startThreshold?: number
  stopThreshold?: number
  sampleCount?: number
  payloadHash?: string
  valid: boolean
  audioBlob?: Blob
}

export interface GuardrailResult {
  accepted: boolean
  reason?:
    | 'silence'
    | 'blacklist'
    | 'repeat'
    | 'invalid_length'
    | 'corrupt_audio'
    | 'empty'
    | 'validation_failed'
    | 'no_transcript'
    | 'tentative'
  text?: string
}

export interface LiveTurn {
  turnId: string
  sessionId: string
  speaker: 'You' | 'Them'
  trackType: TrackType
  text: string
  startMs: number
  endMs: number
  durationMs: number
  provider: string
  confidence?: number
  segmentId: string
  segmentIds?: string[]
}

export type SegmentOutcomeState =
  | 'accepted'
  | 'rejected_silence'
  | 'rejected_blacklist'
  | 'rejected_repeat'
  | 'rejected_invalid_length'
  | 'rejected_corrupt_audio'
  | 'rejected_empty'
  | 'rejected_validation'
  | 'transcription_failed'
  | 'tentative'

export interface SegmentOutcome {
  sessionId: string
  segmentId: string
  trackType: TrackType
  state: SegmentOutcomeState
  reason?: string
  text?: string
  provider?: string
  durationMs: number
  avgRms: number
  peakRms: number
  payloadHash?: string
  timestampMs: number
}

export interface LiveSessionTelemetry {
  speechStarts: number
  finalizedSegments: number
  acceptedSegments: number
  rejectedSegments: number
  rejectedByReason: Record<string, number>
  transcriptionFailures: number
  providerFailures: number
}

export interface LiveInsightRecord {
  displayedAt: number
  insight: LiveInsightData
}

export interface LiveSessionExport {
  sessionId: string
  startedAt: number
  endedAt: number
  acceptedTurns: LiveTurn[]
  rejectedSegments: SegmentOutcome[]
  insightsShown: LiveInsightRecord[]
  telemetry: LiveSessionTelemetry
}

// Extend Window for preload API
declare global {
  interface Window {
    flowraAPI: {
      analyzeConversation: (text: string) => Promise<{ success: boolean; data?: AnalysisResult; error?: string }>
      evaluatePractice: (originalTurn: string, context: string, rewrite: string) => Promise<{ success: boolean; data?: PracticeFeedback; error?: string }>
      generateStyles: (originalTurn: string, context: string) => Promise<{ success: boolean; data?: ResponseStyles; error?: string }>
      liveAnalyze: (conversationSoFar: string, latestMessage: string) => Promise<{ success: boolean; data?: LiveInsightData; error?: string }>
      parseTranscript: (rawText: string) => Promise<{ success: boolean; data?: string; error?: string }>
      openFileDialog: () => Promise<{ success: boolean; data?: { content: string; filename: string }; error?: string }>
      transcribeAudio: (
        base64Audio: string,
        mimeType: string,
        meta?: TranscribeAudioMeta
      ) => Promise<{
        success: boolean
        data?: {
          segments: Array<{ speaker: string; text: string }>
          provider?: string
          confidence?: number
        }
        error?: string
      }>
      abortSession: (sessionId: string) => Promise<void>

      // Dual-track audio
      getDesktopSources: () => Promise<{ success: boolean; data?: Array<{ id: string; name: string }>; error?: string }>

      // Live hotkeys
      registerLiveHotkeys: () => Promise<{ success: boolean; error?: string }>
      unregisterLiveHotkeys: () => Promise<{ success: boolean; error?: string }>

      // Overlay
      toggleOverlay: () => Promise<{ success: boolean; data?: boolean; error?: string }>
      setAlwaysOnTop: (onTop: boolean) => Promise<{ success: boolean; error?: string }>

      meetingBootstrap: () => Promise<{ success: boolean; data?: { overlay: boolean }; error?: string }>
      showMainWindow: () => Promise<{ success: boolean; error?: string }>
      quitApp: () => Promise<{ success: boolean; error?: string }>
      backupTranscript: (text: string) => Promise<{ success: boolean; data?: { path: string }; error?: string }>
      backupLiveSession: (payload: LiveSessionExport) => Promise<{ success: boolean; data?: { path: string }; error?: string }>

      // Window controls
      windowMinimize: () => Promise<{ success: boolean }>
      windowMaximize: () => Promise<{ success: boolean }>
      windowClose: () => Promise<{ success: boolean }>

      onHotkeyToggleRecording: (callback: () => void) => () => void
      onHotkeyQuickAnalysis: (callback: () => void) => () => void
      onHotkeyPauseResume: (callback: () => void) => () => void
      onHotkeyOverlayToggle: (callback: () => void) => () => void
      onHotkeyEndSession: (callback: () => void) => () => void
      onSyncOverlay: (callback: (payload: { overlay: boolean }) => void) => () => void
      onNavigateView: (callback: (payload: { view: string }) => void) => () => void
      onEndMeetingReview: (callback: () => void) => () => void
      onShowLiveTranscript: (callback: () => void) => () => void
    }
  }
}
