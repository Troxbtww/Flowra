import { useEffect, useState } from 'react'
import { getConversationHistory, deleteConversation } from '../lib/analyze'
import type { Conversation } from '../lib/types'

interface Props {
  onSelect: (id: string) => void
  onHome: () => void
}

function scoreColor(score: number): string {
  if (score >= 80) return '#059669'
  if (score >= 60) return '#d97706'
  if (score >= 40) return '#ea580c'
  return '#dc2626'
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

export default function HistoryView({ onSelect, onHome }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const data = await getConversationHistory()
      setConversations(data)
      setLoading(false)
    }
    load()
  }, [])

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (window.confirm('Are you sure you want to delete this conversation?')) {
      await deleteConversation(id)
      setConversations(conversations.filter(c => c.id !== id))
    }
  }

  return (
    <div className="container" style={{ paddingTop: 32 }}>
      <div className="header-bar" style={{ margin: '-32px -24px 24px', padding: '16px 24px' }}>
        <button className="btn-secondary btn-small" onClick={onHome}>Home</button>
        <h3 style={{ margin: 0 }}>History</h3>
        <div style={{ width: 60 }} />
      </div>

      {loading ? (
        <div className="text-center" style={{ paddingTop: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : conversations.length === 0 ? (
        <div className="text-center" style={{ paddingTop: 60 }}>
          <p className="text-dim">No conversations analyzed yet</p>
          <button className="btn-primary mt-16" onClick={onHome}>Analyze Your First Conversation</button>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {conversations.map(conv => (
            <div
              key={conv.id}
              className="history-item flex items-center justify-between"
              onClick={() => onSelect(conv.id)}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {conv.title || 'Untitled Conversation'}
                </div>
                <div className="text-dim text-sm">
                  {formatDate(conv.created_at)} &middot; {conv.turn_count} turns
                </div>
              </div>
              <div className="flex items-center gap-16">
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: scoreColor(conv.overall_score) }}>
                    {conv.overall_score}
                  </div>
                  <div className="text-dim text-sm">score</div>
                </div>
                <button
                  className="btn-secondary btn-small"
                  style={{ padding: '6px 10px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                  onClick={(e) => handleDelete(e, conv.id)}
                  title="Delete Conversation"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
