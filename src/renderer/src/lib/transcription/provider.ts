import { TranscriptionProvider, AudioSegment } from '../types'

/**
 * Standard Transcription Manager to integrate a chosen STT provider.
 */
export class STTManager {
  private primary: TranscriptionProvider
  private fallback?: TranscriptionProvider
  
  constructor(primary: TranscriptionProvider, fallback?: TranscriptionProvider) {
    this.primary = primary
    this.fallback = fallback
  }

  public async transcribe(segment: AudioSegment): Promise<{ text: string, confidence?: number, provider: string } | null> {
    if (!segment.audioBlob) return null
    if (!segment.valid) return null

    const payload = {
      segmentId: segment.segmentId,
      sessionId: segment.sessionId,
      trackType: segment.trackType,
      durationMs: segment.durationMs,
      payloadHash: segment.payloadHash,
      audio: segment.audioBlob,
      format: 'audio/wav',
      languageHint: 'en'
    }

    try {
      const response = await this.primary.transcribe(payload)
      
      return { ...response, provider: this.primary.name }
    } catch (e) {
      if (this.isTransientError(e)) {
        try {
          const retryResponse = await this.primary.transcribe(payload)
          return { ...retryResponse, provider: this.primary.name }
        } catch {
          // fall through to fallback provider
        }
      }

      if (this.fallback) {
        try {
          const fallbackResponse = await this.fallback.transcribe(payload)
          return { ...fallbackResponse, provider: this.fallback.name }
        } catch (fallbackErr) {
          console.error(`Transcription fallback failed for segment ${segment.segmentId}:`, fallbackErr)
        }
      }

      console.error(`Transcription failed for segment ${segment.segmentId}:`, e)
      return null
    }
  }

  private isTransientError(error: unknown): boolean {
    const message = `${error}`.toLowerCase()
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('429') ||
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504')
    )
  }
}

// Mock fallback provider for testing / compilation
export class MockTranscriptionProvider implements TranscriptionProvider {
  name = 'Mock'
  
  async transcribe(input: {
    segmentId: string
    audio: Blob | ArrayBuffer
    format: string
    languageHint?: string
  }) {
    // Artificial latency
    await new Promise(r => setTimeout(r, 400))
    // Just returns a dummy transcript
    return {
      text: 'This is a mock transcript from the audio block.',
      confidence: 0.95
    }
  }
}
