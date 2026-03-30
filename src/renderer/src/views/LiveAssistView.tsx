import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LiveAssistController } from '../lib/live-assist/controller'
import type {
  LiveInsightData,
  LiveSessionExport,
  LiveSessionState,
  LiveTurn,
  SegmentOutcome,
  VadDiagnostics
} from '../lib/types'

interface LiveInsight extends LiveInsightData {
  id: number
  input: string
  speaker: string
  timestamp: Date
}

interface TranscriptEntry {
  speaker: 'You' | 'Them'
  text: string
  timestamp: Date
}

interface Props {
  onBack: () => void
  onEndAndReview: (text: string) => void
  reviewError?: string | null
  onDismissReviewError?: () => void
}

type TrackStatus = 'off' | 'recording' | 'transcribing' | 'error'

const PENDING_TRANSCRIPT_KEY = 'flowra.pendingLiveTranscript'
const SKIP_LIVE_AUTOSTART_KEY = 'flowra.skipLiveAutoRecordOnce'

let didApplyInitialTrayBootstrap = false

function tensionColor(level: number): string {
  if (level <= 3) return '#059669'
  if (level <= 5) return '#d97706'
  if (level <= 7) return '#ea580c'
  return '#dc2626'
}

function tensionLabel(level: number): string {
  if (level <= 2) return 'Calm'
  if (level <= 4) return 'Mild'
  if (level <= 6) return 'Rising'
  if (level <= 8) return 'High'
  return 'Critical'
}

function parseStoredTranscript(raw: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = trimmed.match(/^(You|Them):\s*(.*)$/i)
    if (!m) continue
    const label = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
    if (label === 'You' || label === 'Them') {
      entries.push({ speaker: label, text: m[2], timestamp: new Date() })
    }
  }
  return entries
}

export default function LiveAssistView({
  onBack,
  onEndAndReview,
  reviewError,
  onDismissReviewError
}: Props) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [currentInput, setCurrentInput] = useState('')
  const [speaker, setSpeaker] = useState<'You' | 'Them'>('Them')
  const [isRecording, setIsRecording] = useState(false)
  const [sessionState, setSessionState] = useState<LiveSessionState>('idle')
  const [insights, setInsights] = useState<LiveInsight[]>([])
  const [quickInsight, setQuickInsight] = useState<string | null>(null)
  const [quickInsightData, setQuickInsightData] = useState<LiveInsightData | null>(null)
  const [quickTheirWords, setQuickTheirWords] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isOverlay, setIsOverlay] = useState(false)
  const [sessionActive, setSessionActive] = useState(true)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [micStatus, setMicStatus] = useState<TrackStatus>('off')
  const [audioStatus, setAudioStatus] = useState<TrackStatus>('off')

  const [vadDebug, setVadDebug] = useState<Record<'mic' | 'system', VadDiagnostics | null>>({
    mic: null,
    system: null
  })

  const [segmentStats, setSegmentStats] = useState({
    accepted: 0,
    rejected: 0,
    lastRejectedReason: ''
  })

  const insightIdRef = useRef(0)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef<TranscriptEntry[]>([])
  const controllerRef = useRef<LiveAssistController | null>(null)

  const isRecordingRef = useRef(false)
  const sessionStateRef = useRef<LiveSessionState>('idle')
  const startRecordingRef = useRef<() => Promise<void>>(async () => {})
  const stopRecordingRef = useRef<() => Promise<LiveSessionExport | null>>(async () => null)
  const pauseResumeRef = useRef<() => void>(() => {})
  const toggleRecordingRef = useRef<() => void>(() => {})
  const endMeetingOnceRef = useRef(false)
  const handleEndMeetingFromHotkeyRef = useRef<() => void>(() => {})
  const handleQuickAnalysisRef = useRef<() => void>(() => {})

  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  useEffect(() => {
    const root = document.getElementById('root')
    if (root) {
      root.style.background = isOverlay ? 'transparent' : '#0f0f0f'
    }
  }, [isOverlay])

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript, insights])

  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_TRANSCRIPT_KEY)
    if (!raw?.trim()) return
    sessionStorage.removeItem(PENDING_TRANSCRIPT_KEY)
    const entries = parseStoredTranscript(raw)
    if (entries.length) setTranscript(entries)
  }, [])

  const handleControllerTurn = useCallback((turn: LiveTurn) => {
    const entry: TranscriptEntry = {
      speaker: turn.speaker,
      text: turn.text,
      timestamp: new Date(turn.startMs)
    }
    setTranscript((prev) => [...prev, entry])
  }, [])

  const handleControllerInsight = useCallback((insight: LiveInsightData) => {
    const latestInput = transcriptRef.current[transcriptRef.current.length - 1]
    const item: LiveInsight = {
      id: ++insightIdRef.current,
      input: latestInput?.text ?? '',
      speaker: latestInput?.speaker ?? 'Them',
      ...insight,
      timestamp: new Date()
    }
    setInsights((prev) => [...prev, item])
  }, [])

  const handleSegmentOutcome = useCallback((outcome: SegmentOutcome) => {
    if (outcome.state === 'accepted') {
      setSegmentStats((prev) => ({ ...prev, accepted: prev.accepted + 1 }))
      return
    }

    setSegmentStats((prev) => ({
      accepted: prev.accepted,
      rejected: prev.rejected + 1,
      lastRejectedReason: outcome.state
    }))
  }, [])

  const handleVadDiagnostics = useCallback((diagnostics: VadDiagnostics) => {
    setVadDebug((prev) => ({
      ...prev,
      [diagnostics.trackType]: diagnostics
    }))
  }, [])

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return

    setStatusMsg('Starting Live Assist v2 pipeline...')
    setSegmentStats({ accepted: 0, rejected: 0, lastRejectedReason: '' })

    const controller = new LiveAssistController({
      onTurn: handleControllerTurn,
      onInsight: handleControllerInsight,
      onSegmentOutcome: handleSegmentOutcome,
      onVadDiagnostics: handleVadDiagnostics,
      onStatus: (message) => setStatusMsg(message)
    })

    controllerRef.current = controller

    try {
      const result = await controller.start()
      isRecordingRef.current = true
      setIsRecording(true)
      sessionStateRef.current = 'recording'
      setSessionState('recording')

      const hasMic = result.availableTracks.includes('mic')
      const hasSystem = result.availableTracks.includes('system')
      setMicStatus(hasMic ? 'recording' : 'error')
      setAudioStatus(hasSystem ? 'recording' : 'error')

      if (result.warnings.length) {
        setStatusMsg(result.warnings.join(' | '))
      } else {
        setStatusMsg('Recording with adaptive VAD and utterance segmentation')
      }
    } catch (error: any) {
      console.error('Live Assist start error:', error)
      controllerRef.current = null
      isRecordingRef.current = false
      setIsRecording(false)
      sessionStateRef.current = 'idle'
      setSessionState('idle')
      setMicStatus('error')
      setAudioStatus('error')
      setStatusMsg(`Start failed: ${error?.message ?? String(error)}`)
    }
  }, [
    handleControllerInsight,
    handleControllerTurn,
    handleSegmentOutcome,
    handleVadDiagnostics
  ])

  const stopAllRecording = useCallback(async (): Promise<LiveSessionExport | null> => {
    const controller = controllerRef.current
    controllerRef.current = null

    isRecordingRef.current = false
    setIsRecording(false)
    // Don't override 'ending' state — preserve it for UI
    if (sessionStateRef.current !== 'ending') {
      sessionStateRef.current = 'idle'
      setSessionState('idle')
    }

    if (micStatus !== 'error') setMicStatus('off')
    if (audioStatus !== 'error') setAudioStatus('off')

    if (!controller) {
      return null
    }

    try {
      const exportPayload = await controller.stop()
      return exportPayload
    } catch (error) {
      console.error('Live Assist stop error:', error)
      return null
    }
  }, [audioStatus, micStatus])

  startRecordingRef.current = startRecording
  stopRecordingRef.current = stopAllRecording

  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) {
      void stopAllRecording()
      setStatusMsg('Recording stopped')
    } else {
      void startRecording()
    }
  }, [startRecording, stopAllRecording])

  toggleRecordingRef.current = toggleRecording

  /** Pause/resume: keeps the same session timeline. */
  const pauseResumeRecording = useCallback(() => {
    const controller = controllerRef.current
    if (!controller) return

    if (sessionStateRef.current === 'recording') {
      void controller.pause()
      sessionStateRef.current = 'paused'
      setSessionState('paused')
      setIsRecording(false)
      setStatusMsg('Paused – press Ctrl+Y to resume')
    } else if (sessionStateRef.current === 'paused') {
      void controller.resume()
      sessionStateRef.current = 'recording'
      setSessionState('recording')
      setIsRecording(true)
      setStatusMsg('Recording resumed')
    } else {
      // idle or ending – fall back to old toggle behavior
      toggleRecording()
    }
  }, [toggleRecording])

  pauseResumeRef.current = pauseResumeRecording

  useEffect(() => {
    window.flowraAPI.registerLiveHotkeys()

    // New channels — each fires exactly once per hotkey press
    const unsubPauseResume = window.flowraAPI.onHotkeyPauseResume(() => {
      pauseResumeRef.current()
    })
    const unsubOverlayToggle = window.flowraAPI.onHotkeyOverlayToggle(() => {
      // Main process hides the window; renderer just clears quick panel content
      setQuickInsight(null)
      setQuickInsightData(null)
      setQuickTheirWords(null)
    })
    const unsubQuickAnalysis = window.flowraAPI.onHotkeyQuickAnalysis(() => {
      // Main process shows the overlay window; renderer runs quick analysis
      handleQuickAnalysisRef.current()
    })
    const unsubEndSession = window.flowraAPI.onHotkeyEndSession(() => {
      handleEndMeetingFromHotkeyRef.current()
    })

    const unsubSync = window.flowraAPI.onSyncOverlay(({ overlay }) => {
      setIsOverlay(overlay)
    })
    const unsubEnd = window.flowraAPI.onEndMeetingReview(() => {
      handleEndMeetingFromHotkeyRef.current()
    })
    const unsubShowTranscript = window.flowraAPI.onShowLiveTranscript(() => {
      setIsOverlay(false)
      setTimeout(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 150)
    })

    return () => {
      window.flowraAPI.unregisterLiveHotkeys()
      unsubPauseResume()
      unsubOverlayToggle()
      unsubQuickAnalysis()
      unsubEndSession()
      unsubSync()
      unsubEnd()
      unsubShowTranscript()
      void stopRecordingRef.current()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      if (sessionStorage.getItem(SKIP_LIVE_AUTOSTART_KEY)) {
        sessionStorage.removeItem(SKIP_LIVE_AUTOSTART_KEY)
        return
      }

      await startRecordingRef.current()
      if (cancelled) return

      if (!didApplyInitialTrayBootstrap) {
        didApplyInitialTrayBootstrap = true
        const res = await window.flowraAPI.meetingBootstrap()
        if (!cancelled && res.success && res.data?.overlay) {
          setIsOverlay(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const analyzeMessage = async (text: string, spk: string) => {
    setLoading(true)
    try {
      const allEntries = [...transcriptRef.current, { speaker: spk as 'You' | 'Them', text }]
      const conversationText = allEntries
        .map((entry) => `${entry.speaker}: ${entry.text}`)
        .join('\n')

      const result = await window.flowraAPI.liveAnalyze(conversationText, text)
      if (result.success && result.data) {
        const insight: LiveInsight = {
          id: ++insightIdRef.current,
          input: text,
          speaker: spk,
          ...result.data,
          timestamp: new Date()
        }
        setInsights((prev) => [...prev, insight])
      }
    } catch (err) {
      console.error('Manual live analysis error:', err)
    } finally {
      setLoading(false)
    }
  }

  const addManualMessage = () => {
    if (!currentInput.trim()) return
    const entry: TranscriptEntry = {
      speaker,
      text: currentInput.trim(),
      timestamp: new Date()
    }
    setTranscript((prev) => [...prev, entry])
    void analyzeMessage(currentInput.trim(), speaker)
    setCurrentInput('')
  }

  const dismissQuickPanel = () => {
    setQuickInsight(null)
    setQuickInsightData(null)
    setQuickTheirWords(null)
  }

  const handleQuickAnalysis = useCallback(async () => {
    const lastThemEntry = [...transcriptRef.current].reverse().find((entry) => entry.speaker === 'Them')
    if (!lastThemEntry) {
      setQuickTheirWords(null)
      setQuickInsightData(null)
      setQuickInsight('No capture from the other person yet. Wait for them to speak or check desktop audio.')
      setTimeout(() => setQuickInsight(null), 5000)
      return
    }

    setQuickInsight('Analyzing...')
    setQuickInsightData(null)
    setQuickTheirWords(lastThemEntry.text)

    try {
      const conversationText = transcriptRef.current
        .map((entry) => `${entry.speaker}: ${entry.text}`)
        .join('\n')

      const result = await window.flowraAPI.liveAnalyze(conversationText, lastThemEntry.text)
      if (result.success && result.data) {
        setQuickInsight(null)
        setQuickInsightData(result.data as LiveInsightData)
      } else {
        setQuickInsightData(null)
        setQuickInsight('Analysis failed.')
      }
    } catch (_err) {
      setQuickInsightData(null)
      setQuickInsight('Analysis error.')
    }
  }, [])

  handleQuickAnalysisRef.current = () => {
    void handleQuickAnalysis()
  }

  const handleToggleOverlay = async () => {
    const result = await window.flowraAPI.toggleOverlay()
    if (result.success) {
      setIsOverlay(result.data || false)
    }
  }

  const runEndMeetingAndReview = useCallback(async () => {
    if (endMeetingOnceRef.current) return
    endMeetingOnceRef.current = true
    sessionStateRef.current = 'ending'
    setSessionState('ending')
    setSessionActive(false)

    const exportPayload = await stopAllRecording()
    if (exportPayload) {
      const backup = await window.flowraAPI.backupLiveSession(exportPayload)
      if (backup.success && backup.data?.path) {
        setStatusMsg(`Session debug saved: ${backup.data.path}`)
      }
    }

    // Restore normal window before analysis navigation (Phase 5)
    await window.flowraAPI.showMainWindow()

    const fullText = transcriptRef.current
      .map((entry) => `${entry.speaker}: ${entry.text}`)
      .join('\n')

    onEndAndReview(fullText)
  }, [onEndAndReview, stopAllRecording])

  handleEndMeetingFromHotkeyRef.current = () => {
    void runEndMeetingAndReview()
  }

  const handleEndSession = () => {
    void runEndMeetingAndReview()
  }

  const handleBack = () => {
    void stopAllRecording()
    onBack()
  }

  const latestInsight = insights[insights.length - 1]
  const currentTension = latestInsight?.tension_level || 1

  const statusDot = (status: TrackStatus) => {
    const color =
      status === 'recording'
        ? '#059669'
        : status === 'transcribing'
          ? '#6366f1'
          : status === 'error'
            ? '#dc2626'
            : '#333'
    const anim =
      status === 'recording'
        ? 'pulse 1.5s infinite'
        : status === 'transcribing'
          ? 'pulse 0.8s infinite'
          : 'none'
    return { background: color, animation: anim }
  }

  const vadSummary = ['mic', 'system']
    .map((track) => {
      const item = vadDebug[track as 'mic' | 'system']
      if (!item) return `${track}: --`
      return `${track}: ${item.state} rms=${item.rms.toFixed(4)} nf=${item.noiseFloor.toFixed(4)}`
    })
    .join(' | ')

  return (
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column' }}>
      {!isOverlay && (
        <>
          <div className="header-bar" style={{ WebkitAppRegion: 'drag' } as any}>
            <button
              className="btn-secondary btn-small"
              onClick={handleBack}
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              End
            </button>
            <div className="flex items-center gap-16">
              <h3 style={{ margin: 0 }}>Live Assist</h3>
              <div className="flex items-center gap-8">
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    display: 'inline-block',
                    ...statusDot(isRecording ? 'recording' : 'off')
                  }}
                />
                <span className="text-sm text-dim">
                  {sessionState === 'recording' ? 'Recording' : sessionState === 'paused' ? 'Paused' : sessionActive ? 'Ready' : 'Ended'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-8">
              <button
                className="btn-secondary btn-small"
                onClick={handleToggleOverlay}
                title="Toggle compact overlay"
                style={{ fontSize: 11, WebkitAppRegion: 'no-drag' } as any}
              >
                {isOverlay ? 'Full' : 'Overlay'}
              </button>
              <button
                className="btn-primary btn-small"
                onClick={handleEndSession}
                style={{ WebkitAppRegion: 'no-drag' } as any}
              >
                End and Review
              </button>
            </div>
          </div>

          {reviewError && (
            <div
              style={{
                padding: '12px 20px',
                background: '#2a1515',
                borderBottom: '1px solid #5c2a2a',
                color: '#fecaca',
                fontSize: 13,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12
              }}
            >
              <div style={{ whiteSpace: 'pre-wrap', flex: 1 }}>
                <strong style={{ display: 'block', marginBottom: 6 }}>
                  Could not finish review or save
                </strong>
                {reviewError}
              </div>
              {onDismissReviewError && (
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={onDismissReviewError}
                >
                  Dismiss
                </button>
              )}
            </div>
          )}

          {(quickInsight || quickInsightData) && (
            <div
              style={{
                padding: '12px 20px',
                background: '#121820',
                borderBottom: '1px solid #2a3a4a',
                color: '#e2e8f0',
                fontSize: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#64748b',
                    textTransform: 'uppercase',
                    letterSpacing: 0.06
                  }}
                >
                  Quick read - Ctrl+U
                </span>
                <button
                  type="button"
                  onClick={dismissQuickPanel}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    fontSize: 18,
                    cursor: 'pointer',
                    lineHeight: 1
                  }}
                  aria-label="Dismiss"
                >
                  x
                </button>
              </div>

              {quickInsight && <p style={{ margin: 0, color: '#60a5fa' }}>{quickInsight}</p>}

              {quickTheirWords && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>
                    What they said
                  </div>
                  <p style={{ margin: 0, lineHeight: 1.45, color: '#f1f5f9' }}>{quickTheirWords}</p>
                </div>
              )}

              {quickInsightData && (
                <>
                  {(quickInsightData.meaning || quickInsightData.hidden_meaning) && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>
                        What it means
                      </div>
                      <p style={{ margin: 0, lineHeight: 1.45, color: '#e2e8f0' }}>
                        {quickInsightData.meaning || quickInsightData.hidden_meaning}
                      </p>
                    </div>
                  )}
                  {quickInsightData.suggestion && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#34d399', marginBottom: 4 }}>
                        Suggested reply
                      </div>
                      <p
                        style={{
                          margin: 0,
                          lineHeight: 1.5,
                          color: '#fff',
                          fontSize: 15,
                          fontWeight: 500
                        }}
                      >
                        {quickInsightData.suggestion}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {statusMsg && (
            <div
              style={{
                padding: '6px 20px',
                background: '#1a1a2a',
                borderBottom: '1px solid #2a2a3a',
                color: '#888',
                fontSize: 12,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span>{statusMsg}</span>
              <button
                onClick={() => setStatusMsg(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#555',
                  fontSize: 14,
                  cursor: 'pointer'
                }}
              >
                x
              </button>
            </div>
          )}

          <div
            style={{
              padding: '6px 20px',
              background: '#101722',
              borderBottom: '1px solid #233041',
              color: '#8aa0bf',
              fontSize: 11,
              fontFamily: 'monospace'
            }}
          >
            {vadSummary}
          </div>
        </>
      )}

      {isOverlay ? (
        <div style={{ padding: 8, maxHeight: '100vh', overflow: 'auto', fontFamily: 'system-ui, sans-serif' }}>
          {quickInsight === 'Analyzing...' ? (
            <div
              style={{
                padding: '16px 20px',
                background: 'rgba(15, 15, 18, 0.92)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 14,
                color: '#60a5fa',
                fontSize: 14,
                fontWeight: 600
              }}
            >
              Analyzing...
            </div>
          ) : quickTheirWords || quickInsightData ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '14px 18px',
                gap: 12,
                background: 'rgba(15, 15, 18, 0.92)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 14,
                color: '#fff',
                boxShadow: '0 12px 40px rgba(0,0,0,0.65)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: '#64748b',
                    textTransform: 'uppercase',
                    letterSpacing: 0.08
                  }}
                >
                  For you - Ctrl+U
                </span>
                <button
                  type="button"
                  onClick={dismissQuickPanel}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: 16,
                    cursor: 'pointer',
                    borderRadius: 6,
                    padding: '2px 8px',
                    lineHeight: 1
                  }}
                  aria-label="Dismiss"
                >
                  x
                </button>
              </div>
              {quickInsight && quickInsight !== 'Analyzing...' && (
                <p style={{ margin: 0, color: '#f87171', fontSize: 13 }}>{quickInsight}</p>
              )}
              {quickTheirWords && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', marginBottom: 6 }}>
                    What they said
                  </div>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: '#f1f5f9' }}>
                    {quickTheirWords}
                  </p>
                </div>
              )}
              {quickInsightData && (
                <>
                  {(quickInsightData.meaning || quickInsightData.hidden_meaning) && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#fbbf24', marginBottom: 6 }}>
                        What it means
                      </div>
                      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: '#e2e8f0' }}>
                        {quickInsightData.meaning || quickInsightData.hidden_meaning}
                      </p>
                    </div>
                  )}
                  {quickInsightData.suggestion && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#34d399', marginBottom: 6 }}>
                        Suggested reply
                      </div>
                      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, fontWeight: 600, color: '#fff' }}>
                        {quickInsightData.suggestion}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div
              style={{
                padding: '12px 18px',
                background: 'rgba(15, 15, 18, 0.75)',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#64748b',
                fontSize: 12
              }}
            >
              Flowra {sessionState === 'paused' ? '⏸ Paused' : '● Recording'} — Ctrl+U quick read — Ctrl+Y pause/resume — Shift+Ctrl+Y end and review
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #2a2a2a' }}>
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {transcript.length === 0 && (
                <div className="text-center text-dim" style={{ paddingTop: 40 }}>
                  {isRecording ? (
                    <p style={{ fontSize: 16, marginBottom: 16, color: '#059669' }}>Listening...</p>
                  ) : (
                    <p style={{ fontSize: 16, marginBottom: 16 }}>Press Ctrl+Y to start tracking</p>
                  )}
                </div>
              )}

              <AnimatePresence>
                {transcript.map((entry, i) => (
                  <motion.div
                    key={`${entry.timestamp.getTime()}-${entry.speaker}-${i}`}
                    initial={{ opacity: 0, y: 15, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    style={{
                      marginBottom: 8,
                      textAlign: entry.speaker === 'You' ? 'right' : 'left'
                    }}
                  >
                    <div style={{ marginBottom: 2 }}>
                      <span
                        style={{
                          color: entry.speaker === 'You' ? '#6366f1' : '#059669',
                          fontWeight: 600,
                          fontSize: 11
                        }}
                      >
                        {entry.speaker}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'inline-block',
                        maxWidth: '80%',
                        padding: '8px 14px',
                        borderRadius: 12,
                        background: entry.speaker === 'You' ? '#1a1a3a' : '#1a2a1a',
                        border: `1px solid ${entry.speaker === 'You' ? '#2a2a5a' : '#2a3a2a'}`,
                        textAlign: 'left',
                        fontSize: 14,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                      }}
                    >
                      {entry.text}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {loading && (
                <div style={{ textAlign: 'center', padding: 8 }}>
                  <span className="text-sm text-dim">Analyzing...</span>
                </div>
              )}

              <div ref={transcriptEndRef} />
            </div>

            <div style={{ padding: 12, borderTop: '1px solid #2a2a2a' }}>
              <div className="flex gap-16 items-center mb-8">
                <div className="flex items-center gap-8">
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      display: 'inline-block',
                      ...statusDot(isRecording ? 'recording' : 'off')
                    }}
                  />
                  <span className="text-sm text-dim">{sessionState === 'recording' ? 'Recording' : sessionState === 'paused' ? 'Paused' : 'Ready'}</span>
                </div>

                <div className="text-sm text-dim" style={{ marginLeft: 12 }}>
                  Mic: {micStatus} | System: {audioStatus}
                </div>

                <div className="text-sm text-dim" style={{ marginLeft: 12 }}>
                  Accepted: {segmentStats.accepted} | Rejected: {segmentStats.rejected}
                </div>

                <button
                  onClick={pauseResumeRecording}
                  disabled={!sessionActive || sessionState === 'idle'}
                  style={{
                    marginLeft: 'auto',
                    background: sessionState === 'paused' ? '#d97706' : sessionState === 'recording' ? '#dc2626' : '#059669',
                    color: 'white',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 20px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    animation: sessionState === 'recording' ? 'pulse 1.5s infinite' : 'none'
                  }}
                  title="Ctrl+Y"
                >
                  {sessionState === 'paused' ? 'Resume (Ctrl+Y)' : sessionState === 'recording' ? 'Pause (Ctrl+Y)' : 'Record (Ctrl+Y)'}
                </button>
              </div>

              {segmentStats.lastRejectedReason && (
                <div className="text-sm" style={{ color: '#c084fc', marginBottom: 8 }}>
                  Last rejected: {segmentStats.lastRejectedReason}
                </div>
              )}

              <div className="flex gap-8 items-center">
                <div className="flex gap-4" style={{ flexShrink: 0 }}>
                  <button
                    onClick={() => setSpeaker('Them')}
                    style={{
                      fontSize: 11,
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      background: speaker === 'Them' ? '#059669' : '#2a2a2a',
                      color: speaker === 'Them' ? 'white' : '#888'
                    }}
                  >
                    Them
                  </button>
                  <button
                    onClick={() => setSpeaker('You')}
                    style={{
                      fontSize: 11,
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      background: speaker === 'You' ? '#6366f1' : '#2a2a2a',
                      color: speaker === 'You' ? 'white' : '#888'
                    }}
                  >
                    You
                  </button>
                </div>
                <input
                  type="text"
                  value={currentInput}
                  onChange={(e) => setCurrentInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addManualMessage()}
                  placeholder="Type manually (optional)..."
                  disabled={!sessionActive}
                  style={{
                    flex: 1,
                    background: '#1a1a1a',
                    border: '1px solid #3a3a3a',
                    borderRadius: 8,
                    padding: '8px 12px',
                    color: '#e0e0e0',
                    fontSize: 13,
                    outline: 'none'
                  }}
                />
                <button
                  className="btn-primary btn-small"
                  onClick={addManualMessage}
                  disabled={!currentInput.trim() || !sessionActive}
                >
                  Send
                </button>
              </div>
            </div>
          </div>

          <div style={{ width: 340, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
            <div style={{ padding: 16, borderBottom: '1px solid #2a2a2a' }}>
              <div className="flex justify-between items-center mb-8">
                <span className="text-sm text-dim">Tension Level</span>
                <span style={{ fontWeight: 700, color: tensionColor(currentTension) }}>
                  {tensionLabel(currentTension)}
                </span>
              </div>
              <div className="score-bar-bg">
                <motion.div
                  className="score-bar-fill"
                  initial={{ width: 0 }}
                  animate={{
                    width: `${currentTension * 10}%`,
                    backgroundColor: tensionColor(currentTension)
                  }}
                  transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                />
              </div>
            </div>

            {latestInsight?.alert && (
              <div
                style={{
                  padding: '10px 16px',
                  background: '#2a1010',
                  borderBottom: '1px solid #5a2020',
                  color: '#ff6b6b',
                  fontSize: 13,
                  fontWeight: 600
                }}
              >
                {latestInsight.alert}
              </div>
            )}

            <AnimatePresence mode="popLayout">
              {latestInsight ? (
                <motion.div
                  key={latestInsight.suggestion || 'none'}
                  layout
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  style={{ padding: 16, flex: 1 }}
                >
                  <div
                    className="card"
                    style={{
                      background: 'rgba(15, 31, 47, 0.7)',
                      borderColor: 'rgba(52, 211, 153, 0.2)',
                      marginBottom: 12
                    }}
                  >
                    <h3 style={{ fontSize: 13, color: '#34d399', marginBottom: 6 }}>Suggested reply</h3>
                    <div style={{ fontSize: 14 }}>{latestInsight.suggestion || 'Listening...'}</div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <div className="flex justify-between" style={{ marginBottom: 6 }}>
                      <span className="text-sm text-dim">Tone</span>
                      <span className="text-sm">{latestInsight.emotional_tone}</span>
                    </div>
                    <div className="flex justify-between" style={{ marginBottom: 6 }}>
                      <span className="text-sm text-dim">Intent</span>
                      <span className="text-sm">{latestInsight.intent}</span>
                    </div>
                  </div>

                  {latestInsight.hidden_meaning && (
                    <div
                      className="card"
                      style={{
                        background: 'rgba(30, 30, 20, 0.7)',
                        borderColor: 'rgba(217, 119, 6, 0.2)',
                        marginBottom: 0
                      }}
                    >
                      <h3 style={{ fontSize: 13, color: '#d97706', marginBottom: 6 }}>Hidden Meaning</h3>
                      <div style={{ fontSize: 13, fontStyle: 'italic', color: '#a8a29e' }}>
                        {latestInsight.hidden_meaning}
                      </div>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{
                    padding: 32,
                    textAlign: 'center',
                    color: '#888',
                    fontStyle: 'italic'
                  }}
                >
                  Waiting for conversation to begin...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  )
}
