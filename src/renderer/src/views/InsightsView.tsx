import { useEffect, useState } from 'react'
import { getProgressSnapshots, getConversationHistory } from '../lib/analyze'
import ScoreBar from '../components/ScoreBar'
import type { ProgressSnapshot } from '../lib/analyze'

interface Props {
  onBack: () => void
}

const SKILL_LABELS: Record<string, string> = {
  clarity: 'Clarity',
  emotional_control: 'Emotional Control',
  conflict_handling: 'Conflict Handling'
}

export default function InsightsView({ onBack }: Props) {
  const [snapshots, setSnapshots] = useState<ProgressSnapshot[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const data = await getProgressSnapshots()
      setSnapshots(data)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="container text-center" style={{ paddingTop: 80 }}>
        <div className="spinner" style={{ margin: '0 auto 16px' }} />
        <p className="text-dim">Loading insights...</p>
      </div>
    )
  }

  if (snapshots.length === 0) {
    return (
      <div className="container" style={{ paddingTop: 40 }}>
        <div className="header-bar" style={{ margin: '-40px -24px 24px', padding: '16px 24px' }}>
          <button className="btn-secondary btn-small" onClick={onBack}>Back</button>
          <h3 style={{ margin: 0 }}>Personal Insights</h3>
          <div style={{ width: 60 }} />
        </div>
        <div className="text-center" style={{ paddingTop: 60 }}>
          <p className="text-dim">Analyze at least one conversation to see your insights.</p>
        </div>
      </div>
    )
  }

  // Compute averages from snapshots
  const totalSessions = snapshots.length
  const totalTurns = snapshots.reduce((sum, s) => sum + s.total_turns, 0)

  const skills = ['clarity', 'emotional_control', 'conflict_handling'] as const
  const avgScores: Record<string, number> = {}
  for (const skill of skills) {
    const sum = snapshots.reduce((acc, s) => acc + (s[skill] || 0), 0)
    avgScores[skill] = Math.round(sum / totalSessions)
  }

  // Category totals from snapshots
  const categoryTotals: Record<string, number> = {
    Best: snapshots.reduce((s, p) => s + p.best_count, 0),
    Strong: snapshots.reduce((s, p) => s + p.strong_count, 0),
    Good: snapshots.reduce((s, p) => s + p.good_count, 0),
    Unclear: snapshots.reduce((s, p) => s + p.unclear_count, 0),
    'Missed Opportunity': snapshots.reduce((s, p) => s + p.missed_count, 0),
    Risky: snapshots.reduce((s, p) => s + p.risky_count, 0),
    'Misread Signal': snapshots.reduce((s, p) => s + p.misread_count, 0),
    Escalation: snapshots.reduce((s, p) => s + p.escalation_count, 0),
    Blunder: snapshots.reduce((s, p) => s + p.blunder_count, 0)
  }

  // Score history (latest 10)
  const scoreHistory = snapshots
    .slice(-10)
    .map(s => ({
      date: new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      score: s.overall_score
    }))

  // Detect patterns
  const patterns: string[] = []
  const sortedSkills = Object.entries(avgScores).sort((a, b) => b[1] - a[1])
  if (sortedSkills.length > 0) {
    patterns.push(`Strongest in ${SKILL_LABELS[sortedSkills[0][0]] || sortedSkills[0][0]} (avg ${sortedSkills[0][1]})`)
  }
  if (sortedSkills.length > 1) {
    const weakest = sortedSkills[sortedSkills.length - 1]
    patterns.push(`Weakest in ${SKILL_LABELS[weakest[0]] || weakest[0]} (avg ${weakest[1]})`)
  }
  if (categoryTotals['Escalation'] > 2) {
    patterns.push(`Tendency to escalate (${categoryTotals['Escalation']} instances across sessions)`)
  }
  if (categoryTotals['Missed Opportunity'] > 3) {
    patterns.push(`Frequently misses opportunities to clarify or follow up`)
  }
  if (categoryTotals['Best'] > 3) {
    patterns.push(`Regularly produces excellent communication moments`)
  }

  // Score trend direction
  if (snapshots.length >= 3) {
    const recent3 = snapshots.slice(-3)
    const older3 = snapshots.slice(-6, -3)
    if (older3.length > 0) {
      const recentAvg = recent3.reduce((s, p) => s + p.overall_score, 0) / recent3.length
      const olderAvg = older3.reduce((s, p) => s + p.overall_score, 0) / older3.length
      if (recentAvg > olderAvg + 5) {
        patterns.push(`Scores trending upward (+${Math.round(recentAvg - olderAvg)} recent avg)`)
      } else if (recentAvg < olderAvg - 5) {
        patterns.push(`Scores trending downward (${Math.round(recentAvg - olderAvg)} recent avg)`)
      }
    }
  }

  // Growth areas
  const growthAreas: string[] = []
  if (avgScores.emotional_control < 70) {
    growthAreas.push('Work on emotional regulation — pause before reacting to criticism')
  }
  if (avgScores.conflict_handling < 70) {
    growthAreas.push('Improve conflict handling — acknowledge concerns before defending')
  }
  if (avgScores.clarity < 70) {
    growthAreas.push('Increase clarity — be specific and avoid ambiguous phrasing')
  }
  if (categoryTotals['Missed Opportunity'] > 0) {
    growthAreas.push('Ask more clarifying questions when something seems unclear')
  }
  if (growthAreas.length === 0) {
    growthAreas.push('Keep up the strong communication — look for advanced techniques to refine')
  }

  const CATEGORY_ORDER = [
    'Best', 'Strong', 'Good', 'Unclear',
    'Missed Opportunity', 'Risky', 'Misread Signal', 'Escalation', 'Blunder'
  ]

  return (
    <div className="container" style={{ paddingTop: 40 }}>
      <div className="header-bar" style={{ margin: '-40px -24px 24px', padding: '16px 24px' }}>
        <button className="btn-secondary btn-small" onClick={onBack}>Back</button>
        <h3 style={{ margin: 0 }}>Personal Insights</h3>
        <div style={{ width: 60 }} />
      </div>

      {/* Overview */}
      <div className="card">
        <div className="flex gap-24">
          <div className="text-center" style={{ flex: 1 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#6366f1' }}>{totalSessions}</div>
            <div className="text-dim text-sm">Sessions Analyzed</div>
          </div>
          <div className="text-center" style={{ flex: 1 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#6366f1' }}>{totalTurns}</div>
            <div className="text-dim text-sm">Total Turns</div>
          </div>
          <div className="text-center" style={{ flex: 1 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#6366f1' }}>
              {Math.round(snapshots.reduce((s, p) => s + p.overall_score, 0) / totalSessions)}
            </div>
            <div className="text-dim text-sm">Avg Score</div>
          </div>
        </div>
      </div>

      {/* Score Trend */}
      {scoreHistory.length > 1 && (
        <div className="card">
          <h3 className="mb-16">Score Trend</h3>
          <div className="flex items-center gap-8" style={{ height: 80 }}>
            {scoreHistory.map((point, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  height: Math.max(point.score * 0.6, 10),
                  background: point.score >= 70 ? '#059669' : point.score >= 50 ? '#d97706' : '#dc2626',
                  borderRadius: 4,
                  marginBottom: 4,
                  transition: 'height 0.3s'
                }} />
                <span style={{ fontSize: 10, color: '#888' }}>{point.score}</span>
                <br />
                <span style={{ fontSize: 9, color: '#555' }}>{point.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Average Ratings */}
      <div className="card">
        <h3 className="mb-16">Average Communication Ratings</h3>
        <div className="flex flex-col gap-12">
          {Object.entries(avgScores).map(([key, value]) => (
            <ScoreBar key={key} label={SKILL_LABELS[key] || key} score={value} />
          ))}
        </div>
      </div>

      {/* Category Distribution */}
      <div className="card">
        <h3 className="mb-16">Moment Distribution (All Sessions)</h3>
        <div className="flex flex-col gap-8">
          {CATEGORY_ORDER.map(cat => {
            const count = categoryTotals[cat] || 0
            if (count === 0) return null
            const pct = Math.round((count / totalTurns) * 100)
            return (
              <div key={cat} className="flex items-center gap-12">
                <span className="text-sm" style={{ width: 130 }}>{cat}</span>
                <div className="score-bar-bg" style={{ flex: 1 }}>
                  <div className="score-bar-fill" style={{
                    width: `${pct}%`,
                    background: cat === 'Best' || cat === 'Strong' ? '#059669'
                      : cat === 'Good' ? '#2563eb'
                      : cat === 'Unclear' ? '#d97706'
                      : '#dc2626'
                  }} />
                </div>
                <span className="text-sm text-dim" style={{ width: 40, textAlign: 'right' }}>{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Patterns */}
      {patterns.length > 0 && (
        <div className="card">
          <h3 className="mb-16">Recurring Patterns</h3>
          <div className="flex flex-col gap-8">
            {patterns.map((pattern, i) => (
              <div key={i} className="flex gap-8" style={{ fontSize: 14, color: '#ccc' }}>
                <span style={{ color: '#6366f1' }}>&#8226;</span>
                <span>{pattern}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Growth Areas */}
      <div className="card" style={{ borderColor: '#2a3a2a' }}>
        <h3 className="mb-16" style={{ color: '#4ade80' }}>Suggested Growth Areas</h3>
        <div className="flex flex-col gap-8">
          {growthAreas.slice(0, 4).map((area, i) => (
            <div key={i} className="flex gap-8" style={{ fontSize: 14, color: '#ccc' }}>
              <span style={{ color: '#4ade80' }}>&#10148;</span>
              <span>{area}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
