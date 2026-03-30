import { LiveTurn, AudioSegment, LiveInsightData } from '../types'

/**
 * Timeline Manager aligns 'You' and 'Them' speech events sequentially, handles overlapping audio gracefully, 
 * and provides continuous context to the Live Insight Engine.
 */
export class SessionTimeline {
  private turns: LiveTurn[] = []
  
  // Throttle live reasoning API calls to avoid UI flicker
  private lastInsightMs: number = 0
  private readonly insightCooldownMs: number
  private readonly mergeGapMs: number

  constructor(config: { insightCooldownMs?: number; mergeGapMs?: number } = {}) {
    this.insightCooldownMs = config.insightCooldownMs ?? 3000
    this.mergeGapMs = config.mergeGapMs ?? 400
  }

  public onNewTurn: (turn: LiveTurn) => void = () => {}
  public onLiveInsight: (insight: LiveInsightData) => void = () => {}
  
  public addTurn(segment: AudioSegment, text: string, providerInfo: string) {
    const turn: LiveTurn = {
      turnId: crypto.randomUUID(),
      sessionId: segment.sessionId,
      speaker: segment.trackType === 'mic' ? 'You' : 'Them',
      trackType: segment.trackType,
      text,
      startMs: segment.startTime,
      endMs: segment.endTime,
      durationMs: segment.durationMs,
      provider: providerInfo,
      confidence: undefined,
      segmentId: segment.segmentId
    }

    this.turns.push(turn)
    this.turns.sort((a, b) => a.startMs - b.startMs)

    this.mergeAdjacentTurns()

    const latest = this.turns[this.turns.length - 1]
    if (latest) {
      this.onNewTurn(latest)
    }
    this.evaluateInsightTrigger()
  }

  private mergeAdjacentTurns() {
    if (this.turns.length < 2) return

    const merged: LiveTurn[] = []

    for (const turn of this.turns) {
      const prev = merged[merged.length - 1]
      if (
        prev &&
        prev.speaker === turn.speaker &&
        turn.startMs - prev.endMs <= this.mergeGapMs
      ) {
        prev.text = `${prev.text} ${turn.text}`.replace(/\s+/g, ' ').trim()
        prev.endMs = Math.max(prev.endMs, turn.endMs)
        prev.durationMs = prev.endMs - prev.startMs
        prev.segmentIds = [...(prev.segmentIds ?? [prev.segmentId]), turn.segmentId]
        continue
      }

      merged.push({ ...turn })
    }

    this.turns = merged
  }

  private evaluateInsightTrigger() {
    const now = Date.now()
    if (now - this.lastInsightMs < this.insightCooldownMs) {
      return // Throttled
    }

    const recentTurns = this.turns.slice(-4)
    const hasExchange = new Set(recentTurns.map((turn) => turn.speaker)).size >= 2
    if (recentTurns.length >= 2 && hasExchange) {
      this.lastInsightMs = now
      this.triggerLiveAnalysis(this.turns)
    }
  }

  private triggerLiveAnalysis(context: LiveTurn[]) {
    // Collect context. Real world implementation uses the existing Live Analyze AI bridge
    // Here we wrap generating the payload
    const conversationSoFar = context.map(t => `${t.speaker}: ${t.text}`).join('\n')
    const latestMessage = context[context.length - 1].text

    // This invokes the global API bound in types.ts (preload)
    if (window.flowraAPI?.liveAnalyze) {
      window.flowraAPI.liveAnalyze(conversationSoFar, latestMessage)
        .then(res => {
          if (res.success && res.data) {
            this.onLiveInsight(res.data)
          }
        })
        .catch(console.error)
    }
  }

  public getTurns(): LiveTurn[] {
    return [...this.turns]
  }

  public getFullTranscript(): string {
    return this.turns.map(t => `[${new Date(t.startMs).toISOString()}] ${t.speaker}: ${t.text}`).join('\n')
  }
}
