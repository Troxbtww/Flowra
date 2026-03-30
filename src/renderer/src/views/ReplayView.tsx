import { useEffect, useState } from 'react'
import { getTurns, getConversation } from '../lib/analyze'
import { CategoryBadge } from '../components/CategoryBadge'
import type { DBTurn } from '../lib/types'

interface Props {
  conversationId: string
  onBack: () => void
  onPractice: (turn: DBTurn, context: string) => void
}

function tensionColor(level: number): string {
  if (level <= 3) return '#059669'
  if (level <= 5) return '#d97706'
  if (level <= 7) return '#ea580c'
  return '#dc2626'
}

export default function ReplayView({ conversationId, onBack, onPractice }: Props) {
  const [allTurns, setAllTurns] = useState<DBTurn[]>([])
  const [keyMoments, setKeyMoments] = useState<DBTurn[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAllTurns, setShowAllTurns] = useState(false)
  const [loading, setLoading] = useState(true)
  const [rawText, setRawText] = useState('')

  useEffect(() => {
    const load = async () => {
      const [turns, conv] = await Promise.all([
        getTurns(conversationId),
        getConversation(conversationId)
      ])
      setAllTurns(turns)
      setKeyMoments(turns.filter(t => t.is_key_moment))
      setRawText(conv?.raw_text || '')
      setLoading(false)
    }
    load()
  }, [conversationId])

  if (loading) {
    return (
      <div className="container text-center" style={{ paddingTop: 80 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    )
  }

  const moments = showAllTurns ? allTurns : keyMoments
  const current = moments[currentIndex]

  if (!current) {
    return (
      <div className="container text-center" style={{ paddingTop: 80 }}>
        <p>No moments to review</p>
        <button className="btn-secondary mt-16" onClick={onBack}>Back to Summary</button>
      </div>
    )
  }

  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < moments.length - 1
  const needsPractice = ['Unclear', 'Missed Opportunity', 'Risky', 'Misread Signal', 'Escalation', 'Blunder'].includes(current.category)

  return (
    <div className="container" style={{ paddingTop: 32 }}>
      {/* Header */}
      <div className="header-bar" style={{ margin: '-32px -24px 24px', padding: '16px 24px' }}>
        <button className="btn-secondary btn-small" onClick={onBack}>Back</button>
        <div className="flex items-center gap-12">
          <span className="text-dim text-sm">
            {currentIndex + 1} of {moments.length} {showAllTurns ? 'turns' : 'key moments'}
          </span>
          <button
            className="btn-secondary btn-small"
            onClick={() => { setShowAllTurns(!showAllTurns); setCurrentIndex(0) }}
          >
            {showAllTurns ? 'Key Only' : 'All Turns'}
          </button>
        </div>
        <div style={{ width: 60 }} />
      </div>

      {/* Current Moment */}
      <div className="card">
        <div className="flex items-center justify-between mb-8">
          <CategoryBadge category={current.category} />
          <div className="tension-indicator">
            <span className="text-dim text-sm">Tension</span>
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: tensionColor(current.tension_level)
            }} />
            <span style={{ color: tensionColor(current.tension_level), fontWeight: 600 }}>
              {current.tension_level}/10
            </span>
          </div>
        </div>

        {/* Turn bubble */}
        <div className="turn-bubble">
          <div className="speaker">{current.speaker}</div>
          <div>{current.content}</div>
        </div>

        {/* Emotional tone + intent */}
        <div className="flex gap-16 mt-16">
          <div>
            <span className="text-dim text-sm">Tone: </span>
            <span className="text-sm">{current.emotional_tone}</span>
          </div>
          <div>
            <span className="text-dim text-sm">Intent: </span>
            <span className="text-sm">{current.intent}</span>
          </div>
        </div>

        {/* Explanation */}
        <div className="mt-16">
          <h3>Why This Matters</h3>
          <p style={{ color: '#ccc', fontSize: 14 }}>{current.explanation}</p>
        </div>

        {/* Hidden meaning */}
        {current.hidden_meaning && (
          <div className="mt-16">
            <h3>Hidden Meaning</h3>
            <p style={{ color: '#e0b050', fontSize: 14, fontStyle: 'italic' }}>
              {current.hidden_meaning}
            </p>
          </div>
        )}

        {/* Alternatives */}
        {current.alternatives && current.alternatives.length > 0 && (
          <div className="mt-16">
            <h3>Better Alternative</h3>
            {current.alternatives.map((alt, i) => (
              <div key={i} className="alternative-card">
                <p style={{ fontWeight: 600, color: '#4ade80', marginBottom: 8 }}>
                  &ldquo;{alt.text}&rdquo;
                </p>
                <p className="text-sm" style={{ color: '#aaa', marginBottom: 6 }}>
                  <strong>Why better:</strong> {alt.explanation}
                </p>
                <p className="text-sm" style={{ color: '#aaa' }}>
                  <strong>Predicted outcome:</strong> {alt.predicted_outcome}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Navigation spacer */}
      <div style={{ height: 100 }} />

      {/* Fixed Navigation Bar */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'rgba(10, 10, 12, 0.85)',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
        padding: '16px 0',
        zIndex: 100
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px' }} className="flex justify-between items-center">
          <button
            className="btn-secondary"
            onClick={() => setCurrentIndex(i => i - 1)}
            disabled={!hasPrev}
          >
            Previous
          </button>

          {needsPractice && (
            <button
              className="btn-primary"
              onClick={() => onPractice(current, rawText)}
            >
              Practice This
            </button>
          )}

          <button
            className="btn-secondary"
            onClick={() => setCurrentIndex(i => i + 1)}
            disabled={!hasNext}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
