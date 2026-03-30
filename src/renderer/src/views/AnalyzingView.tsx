interface Props {
  onCancel: () => void
}

export default function AnalyzingView({ onCancel }: Props) {
  return (
    <div className="container text-center" style={{ paddingTop: 120 }}>
      <div className="spinner" style={{ margin: '0 auto 24px' }} />
      <h2>Analyzing Conversation</h2>
      <p className="text-dim mt-8">
        Detecting hidden meaning, emotional shifts, and key moments...
      </p>
      <p className="text-dim text-sm mt-16">This may take 15-30 seconds</p>
      <button className="btn-secondary mt-24" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
