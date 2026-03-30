import { useState } from 'react'
import { evaluatePractice } from '../lib/analyze'
import { CategoryBadge } from '../components/CategoryBadge'
import type { DBTurn, PracticeFeedback, ResponseStyles } from '../lib/types'

interface Props {
  turn: DBTurn
  context: string
  onBack: () => void
}

function scoreColor(score: number): string {
  if (score >= 80) return '#059669'
  if (score >= 60) return '#d97706'
  if (score >= 40) return '#ea580c'
  return '#dc2626'
}

const STYLE_META: Record<string, { label: string; color: string; icon: string }> = {
  calm: { label: 'Calm', color: '#059669', icon: '\uD83D\uDE0C' },
  direct: { label: 'Direct', color: '#2563eb', icon: '\uD83C\uDFAF' },
  diplomatic: { label: 'Diplomatic', color: '#9333ea', icon: '\uD83E\uDD1D' }
}

export default function PracticeView({ turn, context, onBack }: Props) {
  const [rewrite, setRewrite] = useState('')
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null)
  const [styles, setStyles] = useState<ResponseStyles | null>(null)
  const [loadingFeedback, setLoadingFeedback] = useState(false)
  const [loadingStyles, setLoadingStyles] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!rewrite.trim()) return
    setLoadingFeedback(true)
    setError(null)
    setFeedback(null)

    try {
      const result = await evaluatePractice(turn.content, context, rewrite.trim())
      setFeedback(result)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoadingFeedback(false)
    }
  }

  const handleGenerateStyles = async () => {
    setLoadingStyles(true)
    setError(null)

    try {
      const result = await window.flowraAPI.generateStyles(turn.content, context)
      if (result.success && result.data) {
        setStyles(result.data)
      } else {
        setError(result.error || 'Failed to generate styles')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoadingStyles(false)
    }
  }

  const useStyle = (text: string) => {
    setRewrite(text)
  }

  return (
    <div className="container" style={{ paddingTop: 32 }}>
      <div className="header-bar" style={{ margin: '-32px -24px 24px', padding: '16px 24px' }}>
        <button className="btn-secondary btn-small" onClick={onBack}>Back to Replay</button>
        <h3 style={{ margin: 0 }}>Practice Mode</h3>
        <div style={{ width: 100 }} />
      </div>

      {/* Original Turn */}
      <div className="card">
        <div className="flex items-center gap-8 mb-8">
          <span className="text-dim text-sm">Original:</span>
          <CategoryBadge category={turn.category} />
        </div>
        <div className="turn-bubble">
          <div className="speaker">{turn.speaker}</div>
          <div>{turn.content}</div>
        </div>
        {turn.explanation && (
          <p className="text-sm text-dim mt-8">{turn.explanation}</p>
        )}
      </div>

      {/* Response Styles */}
      <div className="card">
        <div className="flex justify-between items-center mb-8">
          <h3>Response Styles</h3>
          <button
            className="btn-secondary btn-small"
            onClick={handleGenerateStyles}
            disabled={loadingStyles}
          >
            {loadingStyles ? 'Generating...' : styles ? 'Regenerate' : 'Generate 3 Styles'}
          </button>
        </div>

        {styles ? (
          <div className="flex flex-col gap-8">
            {(Object.entries(styles) as [string, { text: string; effect: string }][]).map(([key, variant]) => {
              const meta = STYLE_META[key]
              if (!meta) return null
              return (
                <div key={key} style={{
                  background: '#151515',
                  border: `1px solid ${meta.color}33`,
                  borderRadius: 10,
                  padding: 14
                }}>
                  <div className="flex justify-between items-center mb-8">
                    <span style={{ fontWeight: 600, color: meta.color, fontSize: 14 }}>
                      {meta.icon} {meta.label}
                    </span>
                    <button
                      className="btn-small"
                      onClick={() => useStyle(variant.text)}
                      style={{
                        background: meta.color + '22',
                        color: meta.color,
                        border: `1px solid ${meta.color}44`,
                        fontSize: 11,
                        padding: '3px 10px'
                      }}
                    >
                      Use This
                    </button>
                  </div>
                  <p style={{ fontSize: 14, color: '#e0e0e0', marginBottom: 6 }}>
                    &ldquo;{variant.text}&rdquo;
                  </p>
                  <p className="text-sm text-dim">{variant.effect}</p>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-dim text-sm">
            Generate three different response styles: calm, direct, and diplomatic.
          </p>
        )}
      </div>

      {/* Rewrite Input */}
      <div className="card">
        <h3 className="mb-8">Your Rewrite</h3>
        <p className="text-dim text-sm mb-8">Write your own version, or use a generated style above as a starting point.</p>
        <textarea
          rows={4}
          placeholder="Write your improved version..."
          value={rewrite}
          onChange={(e) => setRewrite(e.target.value)}
          disabled={loadingFeedback}
        />
        <div className="mt-16" style={{ textAlign: 'right' }}>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={!rewrite.trim() || loadingFeedback}
          >
            {loadingFeedback ? 'Evaluating...' : 'Get Feedback'}
          </button>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {/* Feedback */}
      {feedback && (
        <div className="card" style={{ borderColor: scoreColor(feedback.score) + '44' }}>
          <div className="flex items-center justify-between mb-16">
            <h3>Feedback</h3>
            <div>
              <span style={{ fontSize: 32, fontWeight: 800, color: scoreColor(feedback.score) }}>
                {feedback.score}
              </span>
              <span className="text-dim text-sm">/100</span>
            </div>
          </div>

          <div className="mb-16">
            <span className="text-dim text-sm">Tone: </span>
            <span>{feedback.tone_assessment}</span>
          </div>

          <div className="mb-16">
            <h3 style={{ color: '#4ade80' }}>What Improved</h3>
            <p style={{ color: '#ccc', fontSize: 14 }}>{feedback.improvement}</p>
          </div>

          {feedback.still_missing && (
            <div className="mb-16">
              <h3 style={{ color: '#d97706' }}>Still Could Improve</h3>
              <p style={{ color: '#ccc', fontSize: 14 }}>{feedback.still_missing}</p>
            </div>
          )}

          <div>
            <h3>Predicted Response</h3>
            <p style={{ color: '#ccc', fontSize: 14, fontStyle: 'italic' }}>
              {feedback.predicted_outcome}
            </p>
          </div>
        </div>
      )}

      {/* AI alternative reference */}
      {turn.alternatives && turn.alternatives.length > 0 && (
        <div className="card" style={{ opacity: 0.7 }}>
          <h3 className="text-dim">AI Suggested Alternative (for reference)</h3>
          <p className="mt-8" style={{ color: '#4ade80', fontSize: 14 }}>
            &ldquo;{turn.alternatives[0].text}&rdquo;
          </p>
        </div>
      )}
    </div>
  )
}
