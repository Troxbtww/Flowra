interface Props {
  label: string
  score: number
}

function barColor(score: number): string {
  if (score >= 80) return '#059669'
  if (score >= 60) return '#2563eb'
  if (score >= 40) return '#d97706'
  return '#dc2626'
}

export default function ScoreBar({ label, score }: Props) {
  return (
    <div>
      <div className="flex justify-between items-center mb-8" style={{ marginBottom: 4 }}>
        <span className="text-sm">{label}</span>
        <span className="text-sm" style={{ fontWeight: 600, color: barColor(score) }}>
          {score}
        </span>
      </div>
      <div className="score-bar-bg">
        <div
          className="score-bar-fill"
          style={{ width: `${score}%`, background: barColor(score) }}
        />
      </div>
    </div>
  )
}
