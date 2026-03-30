import { AudioSegment, GuardrailResult, TrackType } from '../types'

const DEFAULT_BLACKLIST = [
  "hello, how are you?",
  "i'm not sure what you're talking about",
  'please provide the file',
  'subtitles by amaririsu',
  'subtitles continue',
  'subtitles by'
]

export interface TranscriptGuardrailOptions {
  blacklist?: string[]
  repeatWindowSize?: number
  repeatCooldownMs?: number
}

interface TrackRepeatState {
  recent: string[]
  cooldownUntilMs: number
}

const TRACK_STATE: Record<TrackType, TrackRepeatState> = {
  mic: { recent: [], cooldownUntilMs: 0 },
  system: { recent: [], cooldownUntilMs: 0 }
}

function normalizeTranscript(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

function mapSilenceToken(text: string): boolean {
  const lowered = text.toLowerCase()
  return (
    lowered === '[silence]' ||
    lowered === 'silence' ||
    lowered.includes('no clear speech') ||
    lowered.includes('no speech')
  )
}

function mapDensityViolation(durationMs: number, normalizedText: string): boolean {
  const words = normalizedText.split(/\s+/).filter(Boolean)
  const baseMaxWords = Math.max(2, (durationMs / 1000) * 4)
  return words.length > baseMaxWords * 2
}

export function createTranscriptGuardrails(options: TranscriptGuardrailOptions = {}) {
  const blacklist = (options.blacklist ?? DEFAULT_BLACKLIST).map((item) => item.toLowerCase())
  const repeatWindowSize = options.repeatWindowSize ?? 5
  const repeatCooldownMs = options.repeatCooldownMs ?? 8000

  return function validate(segment: AudioSegment, textOriginal?: string, confidence?: number): GuardrailResult {
    if (!textOriginal) {
      return { accepted: false, reason: 'empty' }
    }

    const normalized = normalizeTranscript(textOriginal)
    const lowered = normalized.toLowerCase()

    if (!normalized) {
      return { accepted: false, reason: 'empty' }
    }

    if (mapSilenceToken(lowered)) {
      return { accepted: false, reason: 'silence' }
    }

    for (const phrase of blacklist) {
      if (lowered.includes(phrase)) {
        return { accepted: false, reason: 'blacklist', text: normalized }
      }
    }

    if (mapDensityViolation(segment.durationMs, normalized)) {
      return { accepted: false, reason: 'invalid_length', text: normalized }
    }

    if (typeof confidence === 'number' && confidence > 0 && confidence < 0.25) {
      return { accepted: false, reason: 'tentative', text: normalized }
    }

    const state = TRACK_STATE[segment.trackType]
    const now = Date.now()

    if (state.cooldownUntilMs > now) {
      return { accepted: false, reason: 'repeat', text: normalized }
    }

    const duplicateCount = state.recent.filter((entry) => entry === lowered).length
    if (duplicateCount >= 3 && normalized.split(' ').length <= 8) {
      state.cooldownUntilMs = now + repeatCooldownMs
      return { accepted: false, reason: 'repeat', text: normalized }
    }

    state.recent.push(lowered)
    if (state.recent.length > repeatWindowSize) {
      state.recent.shift()
    }

    return { accepted: true, text: normalized }
  }
}

const defaultGuardrail = createTranscriptGuardrails()

export function validateTranscript(segment: AudioSegment, textOriginal?: string, confidence?: number): GuardrailResult {
  return defaultGuardrail(segment, textOriginal, confidence)
}
