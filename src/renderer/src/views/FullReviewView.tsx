import { useEffect, useState } from 'react'
import { getTurns, getConversation } from '../lib/analyze'
import type { DBTurn, Conversation } from '../lib/types'

interface Props {
  conversationId: string
  onBack: () => void
}

function getAnnotation(category: string): { icon: string, color: string, bg: string } | null {
  switch (category) {
    case 'Best': return { icon: '★', color: '#fff', bg: '#059669' }
    case 'Strong': return { icon: '!!', color: '#fff', bg: '#0d9488' }
    case 'Good': return null // Normal moves don't get an explicit badge
    case 'Unclear': return { icon: '?!', color: '#fff', bg: '#d97706' }
    case 'Missed Opportunity': return { icon: '✕', color: '#fff', bg: '#9333ea' }
    case 'Risky': return { icon: '⚠', color: '#fff', bg: '#ea580c' }
    case 'Misread Signal': return { icon: '?', color: '#fff', bg: '#dc2626' }
    case 'Escalation': return { icon: '⇈', color: '#fff', bg: '#be123c' }
    case 'Blunder': return { icon: '??', color: '#fff', bg: '#7f1d1d' }
    default: return null
  }
}

export default function FullReviewView({ conversationId, onBack }: Props) {
  const [turns, setTurns] = useState<DBTurn[]>([])
  const [conv, setConv] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const [t, c] = await Promise.all([
        getTurns(conversationId),
        getConversation(conversationId)
      ])
      setTurns(t)
      setConv(c)
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

  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 80 }}>
      {/* Header */}
      <div className="header-bar" style={{ margin: '-32px -24px 24px', padding: '16px 24px', position: 'sticky', top: 0, zIndex: 10 }}>
        <button className="btn-secondary btn-small" onClick={onBack}>Back</button>
        <h3 style={{ margin: 0 }}>Full Conversation Review</h3>
        <div style={{ width: 60 }} />
      </div>

      <div className="flex flex-col gap-16">
        {turns.map((turn, index) => {
          const annotation = getAnnotation(turn.category)
          const isUser = turn.speaker.toLowerCase() === 'me' || turn.speaker.toLowerCase() === 'you' || turn.speaker === 'Speaker 1'

          return (
            <div 
              key={turn.id || index} 
              className="turn-bubble" 
              style={{
                position: 'relative',
                background: isUser ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                border: isUser ? '1px solid rgba(99, 102, 241, 0.2)' : '1px solid rgba(255, 255, 255, 0.04)',
                marginLeft: isUser ? 'auto' : '0',
                marginRight: isUser ? '0' : 'auto',
                maxWidth: '85%'
              }}
            >
              {/* Chess.com style annotation badge */}
              {annotation && (
                <div 
                  title={turn.category}
                  className="annotation-badge"
                  style={{
                    position: 'absolute',
                    top: -10,
                    right: -10,
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: annotation.bg,
                    color: annotation.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 12,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    border: '2px solid #111'
                  }}
                >
                  {annotation.icon}
                </div>
              )}

              <div className="speaker" style={{ color: isUser ? '#818cf8' : '#e2e8f0' }}>
                {turn.speaker}
              </div>
              <div style={{ fontSize: 15, lineHeight: 1.6 }}>{turn.content}</div>

              {/* Show explanation only for non-Good categories where annotation exists */}
              {annotation && turn.explanation && (
                <div className="mt-12" style={{ 
                  fontSize: 13, 
                  color: '#a1a1aa',
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                  paddingTop: 8
                }}>
                  <strong style={{ color: annotation.bg }}>{turn.category}:</strong> {turn.explanation}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
