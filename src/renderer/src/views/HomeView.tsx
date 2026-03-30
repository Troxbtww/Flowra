import { useEffect, useState } from 'react'
import { getConversationHistory } from '../lib/analyze'
import { getCategoryClass } from '../components/CategoryBadge'
import SpotlightCard from '../components/SpotlightCard'
import { FileSearch, Zap } from 'lucide-react'
import type { Conversation } from '../lib/types'

interface Props {
  onNewAnalysis: () => void
  onLiveAssist: () => void
  onViewConversation: (id: string) => void
  onHistory: () => void
  onInsights: () => void
}

function scoreColor(score: number): string {
  if (score >= 80) return '#059669'
  if (score >= 60) return '#d97706'
  if (score >= 40) return '#ea580c'
  return '#dc2626'
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

  if (diffHours < 1) return 'Just now'
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getResultLabel(score: number): { text: string; color: string } {
  if (score >= 85) return { text: 'Strong Outcome', color: '#059669' }
  if (score >= 70) return { text: 'Productive', color: '#2563eb' }
  if (score >= 55) return { text: 'Mixed', color: '#d97706' }
  if (score >= 40) return { text: 'Tense', color: '#ea580c' }
  return { text: 'Unresolved', color: '#dc2626' }
}

export default function HomeView({ onNewAnalysis, onLiveAssist, onViewConversation, onHistory, onInsights }: Props) {
  const [recent, setRecent] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const all = await getConversationHistory()
      setRecent(all.slice(0, 5))
      setLoading(false)
    }
    load()
  }, [])

  // Compute quick stats from recent conversations
  const totalSessions = recent.length
  const avgScore = totalSessions > 0
    ? Math.round(recent.reduce((sum, c) => sum + (c.overall_score || 0), 0) / totalSessions)
    : 0

  const SKILL_LABELS: Record<string, string> = {
    clarity: 'Clarity',
    emotional_control: 'Emotional Control',
    conflict_handling: 'Conflict Handling'
  }

  // Find strongest skill across recent sessions
  const skillTotals: Record<string, number[]> = {}
  for (const conv of recent) {
    if (conv.scores) {
      for (const [key, val] of Object.entries(conv.scores)) {
        if (SKILL_LABELS[key]) {
          if (!skillTotals[key]) skillTotals[key] = []
          skillTotals[key].push(val as number)
        }
      }
    }
  }
  const skillAvgs = Object.entries(skillTotals).map(([key, vals]) => ({
    key,
    avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
  })).sort((a, b) => b.avg - a.avg)

  const strongestSkill = skillAvgs[0]
  const weakestSkill = skillAvgs[skillAvgs.length - 1]

  return (
    <div className="container" style={{ paddingTop: 40 }}>
      {/* Header */}
      <div className="flex justify-between items-center mb-16" style={{ WebkitAppRegion: 'drag' } as any}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Flowra</h1>
          <p className="text-dim text-sm">Communication Intelligence</p>
        </div>
        <div className="flex items-center gap-8">
          <button className="btn-secondary btn-small animate-fade-in-up" onClick={onInsights} style={{ WebkitAppRegion: 'no-drag' } as any}>
            Insights
          </button>
        </div>
      </div>

      {/* Main Actions removed per request */}

      {/* Quick Stats */}
      {totalSessions > 0 && (
        <div className="card animate-fade-in-up" style={{ marginBottom: 24, padding: '16px 20px', animationDelay: '0.1s' }}>
          <div className="flex gap-24 items-center justify-between">
            <div className="text-center">
              <div className="shiny-text" style={{ fontSize: 28, fontWeight: 800 }}>
                {avgScore}
              </div>
              <div className="text-dim text-sm">Avg Score</div>
            </div>
            <div className="text-center">
              <div className="shiny-text" style={{ fontSize: 28, fontWeight: 800 }}>
                {totalSessions}
              </div>
              <div className="text-dim text-sm">Sessions</div>
            </div>
            {strongestSkill && (
              <div className="text-center">
                <div style={{ fontSize: 16, fontWeight: 700, color: '#059669' }}>
                  {SKILL_LABELS[strongestSkill.key] || strongestSkill.key}
                </div>
                <div className="text-dim text-sm">Strongest</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent Sessions */}
      <div className="flex justify-between items-center mb-8">
        <h3>Recent Sessions</h3>
        {totalSessions > 0 && (
          <button className="btn-secondary btn-small" onClick={onHistory}>View All</button>
        )}
      </div>

      {loading ? (
        <div className="text-center" style={{ padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : recent.length === 0 ? (
        <div className="card text-center" style={{ padding: 40 }}>
          <p className="text-dim">No sessions yet. Analyze your first conversation!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {recent.map(conv => {
            const result = getResultLabel(conv.overall_score)
            return (
              <div
                key={conv.id}
                className="history-item"
                onClick={() => onViewConversation(conv.id)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {conv.title || 'Untitled'}
                  </div>
                  <div className="flex gap-8 items-center">
                    <span className="text-dim text-sm">{formatDate(conv.created_at)}</span>
                    <span className="text-sm" style={{ color: result.color }}>{result.text}</span>
                  </div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: scoreColor(conv.overall_score) }}>
                  {conv.overall_score}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
