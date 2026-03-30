import { useEffect, useState } from 'react'
import { getConversation, getTurns } from '../lib/analyze'
import { getCategoryClass } from '../components/CategoryBadge'
import ScoreBar from '../components/ScoreBar'
import type { Conversation, DBTurn } from '../lib/types'

interface Props {
  conversationId: string
  onReplay: () => void
  onFullReview: () => void
  onHome: () => void
}

function scoreColor(score: number): string {
  if (score >= 80) return '#059669'
  if (score >= 60) return '#d97706'
  if (score >= 40) return '#ea580c'
  return '#dc2626'
}

const SCORE_LABELS: Record<string, string> = {
  clarity: 'Clarity',
  emotional_control: 'Emotional Control',
  conflict_handling: 'Conflict Handling'
}

const CATEGORY_ORDER = [
  'Best', 'Strong', 'Good', 'Unclear',
  'Missed Opportunity', 'Risky', 'Misread Signal', 'Escalation', 'Blunder'
]

export default function SummaryView({ conversationId, onReplay, onFullReview, onHome }: Props) {
  const [conv, setConv] = useState<Conversation | null>(null)
  const [turns, setTurns] = useState<DBTurn[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [c, t] = await Promise.all([
        getConversation(conversationId),
        getTurns(conversationId)
      ])
      setConv(c)
      setTurns(t)
      setLoading(false)
    }
    load()
  }, [conversationId])

  if (loading || !conv) {
    return (
      <div className="container text-center" style={{ paddingTop: 80 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    )
  }

  const keyMoments = turns.filter(t => t.is_key_moment)

  return (
    <div className="container" style={{ paddingTop: 32 }}>
      <div className="header-bar" style={{ margin: '-32px -24px 24px', padding: '16px 24px' }}>
        <button className="btn-secondary btn-small" onClick={onHome}>Home</button>
        <h3 style={{ margin: 0 }}>Analysis Summary</h3>
        <div style={{ width: 60 }} />
      </div>

      {/* Overall Score */}
      <div className="card text-center">
        <div className="score-big" style={{ color: scoreColor(conv.overall_score) }}>
          {conv.overall_score}
        </div>
        <div className="score-label">Overall Communication Score</div>
      </div>

      {/* Summary */}
      <div className="card">
        <h3>Summary</h3>
        <p style={{ color: '#ccc' }}>{conv.summary}</p>
        <p className="text-dim text-sm mt-8">
          {conv.turn_count} turns &middot; {keyMoments.length} key moments
        </p>
      </div>

      {/* Dimension Scores */}
      <div className="card">
        <h3 className="mb-16">Communication Ratings</h3>
        <div className="flex flex-col gap-12">
          {Object.entries(conv.scores)
            .filter(([key]) => Object.keys(SCORE_LABELS).includes(key))
            .map(([key, value]) => (
            <ScoreBar key={key} label={SCORE_LABELS[key] || key} score={value as number} />
          ))}
        </div>
      </div>

      {/* Category Counts */}
      <div className="card">
        <h3 className="mb-16">Moment Breakdown</h3>
        <div className="flex flex-wrap gap-8">
          {CATEGORY_ORDER.map(cat => {
            const count = (conv.category_counts as Record<string, number>)[cat]
            if (!count) return null
            return (
              <div key={cat} className="flex items-center gap-8">
                <span className={`category-badge ${getCategoryClass(cat)}`}>{cat}</span>
                <span className="text-dim">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-12 mt-16" style={{ justifyContent: 'center' }}>
        <button className="btn-primary" onClick={onFullReview} style={{ minWidth: 180 }}>
          View Full Review
        </button>
      </div>
    </div>
  )
}
