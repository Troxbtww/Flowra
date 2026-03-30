import { useState, useEffect } from 'react'
import HomeView from './views/HomeView'
import PasteView from './views/PasteView'
import AnalyzingView from './views/AnalyzingView'
import SummaryView from './views/SummaryView'
import ReplayView from './views/ReplayView'
import PracticeView from './views/PracticeView'
import HistoryView from './views/HistoryView'
import LiveAssistView from './views/LiveAssistView'
import InsightsView from './views/InsightsView'
import FullReviewView from './views/FullReviewView'
import { analyzeAndSave } from './lib/analyze'
import type { DBTurn } from './lib/types'

const PENDING_TRANSCRIPT_KEY = 'flowra.pendingLiveTranscript'
const SKIP_LIVE_AUTOSTART_KEY = 'flowra.skipLiveAutoRecordOnce'

type View = 'home' | 'paste' | 'analyzing' | 'summary' | 'replay' | 'practice' | 'history' | 'live' | 'insights' | 'full-review'

export default function App() {
  const [view, setView] = useState<View>('live')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [practiceTurn, setPracticeTurn] = useState<DBTurn | null>(null)
  const [conversationContext, setConversationContext] = useState<string>('')
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [isOverlay, setIsOverlay] = useState(false)

  const handleAnalyzeFromPaste = async (text: string) => {
    setAnalysisError(null)
    setView('analyzing')

    try {
      const id = await analyzeAndSave(text)
      setConversationId(id)
      setView('summary')
    } catch (err: any) {
      setAnalysisError(err.message)
      setView('paste')
    }
  }

  /** After Live Assist: backup raw text, analyze, save to Supabase History. */
  const handleAnalyzeFromLive = async (text: string) => {
    setAnalysisError(null)
    sessionStorage.setItem(PENDING_TRANSCRIPT_KEY, text)
    setView('analyzing')

    let backupNote = ''
    try {
      const backup = await window.flowraAPI.backupTranscript(text)
      if (backup.success && backup.data?.path) {
        backupNote = `\n\nRaw transcript also saved on disk:\n${backup.data.path}`
      }
    } catch {
      /* non-fatal */
    }

    try {
      const id = await analyzeAndSave(text)
      sessionStorage.removeItem(PENDING_TRANSCRIPT_KEY)
      setConversationId(id)
      setView('summary')
    } catch (err: any) {
      const msg = (err as Error).message + backupNote
      setAnalysisError(msg)
      sessionStorage.setItem(SKIP_LIVE_AUTOSTART_KEY, '1')
      setView('live')
    }
  }

  const goToSummary = (id: string) => {
    setConversationId(id)
    setView('summary')
  }

  const goToPractice = (turn: DBTurn, context: string) => {
    setPracticeTurn(turn)
    setConversationContext(context)
    setView('practice')
  }

  const goHome = () => {
    sessionStorage.removeItem(PENDING_TRANSCRIPT_KEY)
    sessionStorage.removeItem(SKIP_LIVE_AUTOSTART_KEY)
    setConversationId(null)
    setAnalysisError(null)
    setView('home')
  }

  useEffect(() => {
    const unsubNav = window.flowraAPI.onNavigateView((payload) => {
      const v = payload.view as View
      if (v === 'home' || v === 'live') setView(v)
    })
    const unsubOverlay = window.flowraAPI.onSyncOverlay((payload) => {
      setIsOverlay(payload.overlay)
    })
    return () => {
      unsubNav()
      unsubOverlay()
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {!isOverlay && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 20px', background: 'transparent',
          WebkitAppRegion: 'drag' as any, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.05em' }}>FLOWRA</div>
          <div style={{ display: 'flex', gap: 12, WebkitAppRegion: 'no-drag' as any }}>
            <button className="window-btn minimize" onClick={() => window.flowraAPI.windowMinimize()}>_</button>
            <button className="window-btn maximize" onClick={() => window.flowraAPI.windowMaximize()}>□</button>
            <button className="window-btn close" onClick={() => window.flowraAPI.windowClose()}>×</button>
          </div>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative', display: 'flex', flexDirection: 'column', paddingTop: !isOverlay ? 40 : 0 }}>
        {view === 'home' && (
        <HomeView
          onNewAnalysis={() => setView('paste')}
          onLiveAssist={() => setView('live')}
          onViewConversation={goToSummary}
          onHistory={() => setView('history')}
          onInsights={() => setView('insights')}
        />
      )}
      {view === 'paste' && (
        <PasteView
          onAnalyze={handleAnalyzeFromPaste}
          onHistory={() => setView('history')}
          error={analysisError}
        />
      )}
      {view === 'analyzing' && <AnalyzingView onCancel={goHome} />}
      {view === 'summary' && conversationId && (
        <SummaryView
          conversationId={conversationId}
          onReplay={() => setView('replay')}
          onFullReview={() => setView('full-review')}
          onHome={goHome}
        />
      )}
      {view === 'full-review' && conversationId && (
        <FullReviewView
          conversationId={conversationId}
          onBack={() => setView('summary')}
        />
      )}
      {view === 'replay' && conversationId && (
        <ReplayView
          conversationId={conversationId}
          onBack={() => setView('summary')}
          onPractice={goToPractice}
        />
      )}
      {view === 'practice' && practiceTurn && (
        <PracticeView
          turn={practiceTurn}
          context={conversationContext}
          onBack={() => setView('replay')}
        />
      )}
      {view === 'history' && (
        <HistoryView
          onSelect={goToSummary}
          onHome={goHome}
        />
      )}
      {view === 'live' && (
        <LiveAssistView
          onBack={goHome}
          onEndAndReview={handleAnalyzeFromLive}
          reviewError={analysisError}
          onDismissReviewError={() => setAnalysisError(null)}
        />
      )}
      {view === 'insights' && (
        <InsightsView onBack={goHome} />
      )}
      </div>
    </div>
  )
}
