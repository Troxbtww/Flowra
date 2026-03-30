import { useState } from 'react'

interface Props {
  onAnalyze: (text: string) => void
  onHistory: () => void
  error: string | null
}

export default function PasteView({ onAnalyze, onHistory, error }: Props) {
  const [text, setText] = useState('')
  const [importStatus, setImportStatus] = useState<string | null>(null)

  const handleImportFile = async () => {
    setImportStatus(null)
    try {
      const result = await window.flowraAPI.openFileDialog()
      if (!result.success) return // User cancelled

      const { content, filename } = result.data!
      // Parse and normalize the transcript
      const parsed = await window.flowraAPI.parseTranscript(content)

      if (parsed.success && parsed.data) {
        setText(parsed.data)
        setImportStatus(`Imported: ${filename}`)
      } else {
        // Fallback: use raw content
        setText(content)
        setImportStatus(`Imported (raw): ${filename}`)
      }
    } catch (err: any) {
      setImportStatus(`Import failed: ${err.message}`)
    }
  }

  return (
    <div className="container" style={{ paddingTop: 60 }}>
      <div className="text-center mb-16">
        <h1>Review a Conversation</h1>
        <p className="text-dim">Paste text or import a transcript file</p>
      </div>

      <div className="flex justify-between items-center mb-8">
        <span className="text-sm text-dim">Conversation text</span>
        <button
          className="btn-secondary btn-small"
          onClick={handleImportFile}
          style={{ fontSize: 12 }}
        >
          Import Transcript (.txt, .vtt, .srt)
        </button>
      </div>

      {importStatus && (
        <div className="text-sm mb-8" style={{ color: importStatus.includes('failed') ? '#ff6b6b' : '#4ade80' }}>
          {importStatus}
        </div>
      )}

      <textarea
        rows={14}
        placeholder={`Paste your conversation here...\n\nSupported formats:\n- Plain text with speaker labels (Alice: Hello)\n- Zoom transcripts\n- Google Meet transcripts\n- Teams transcripts\n- VTT / SRT subtitle files`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {error && (
        <div className="error-msg mt-16">{error}</div>
      )}

      <div className="flex gap-12 mt-16" style={{ justifyContent: 'space-between' }}>
        <button className="btn-secondary" onClick={onHistory}>
          Back
        </button>
        <button
          className="btn-primary"
          onClick={() => onAnalyze(text.trim())}
          disabled={!text.trim()}
          style={{ minWidth: 160 }}
        >
          Analyze Conversation
        </button>
      </div>

      <div className="text-center mt-24 text-dim text-sm">
        <p>Tip: Include speaker labels (e.g. "Alice:", "Bob:") for better analysis</p>
      </div>
    </div>
  )
}
