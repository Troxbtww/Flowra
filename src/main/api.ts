function getApiKey(): string {
  return process.env['OPENROUTER_API_KEY'] || ''
}

/** Cached result: does the live-analysis model support response_format: json_object? */
let jsonObjectSupported: boolean | null = null

const ANALYSIS_SYSTEM_PROMPT = `You are a conversation intelligence analyst. You analyze conversations between people and provide detailed communication feedback.

Given a conversation transcript, analyze it and return a JSON object with this EXACT structure. Return ONLY valid JSON, no markdown, no explanation outside the JSON.

{
  "summary": "2-3 sentence summary of the conversation and how it went",
  "overall_score": <number 0-100>,
  "scores": {
    "clarity": <number 0-100>,
    "emotional_control": <number 0-100>,
    "conflict_handling": <number 0-100>
  },
  "turns": [
    {
      "turn_index": 0,
      "speaker": "Speaker name or label",
      "content": "exact text from conversation",
      "emotional_tone": "e.g. neutral, frustrated, angry, hopeful, anxious, confident, defensive, dismissive, empathetic, sarcastic",
      "intent": "brief description of what the speaker is trying to achieve",
      "hidden_meaning": "what they actually mean beneath the surface, or null if straightforward",
      "tension_level": <number 1-10>,
      "category": "Best|Strong|Good|Unclear|Missed Opportunity|Risky|Misread Signal|Escalation|Blunder",
      "is_key_moment": true/false,
      "explanation": "why this moment matters for the conversation",
      "alternatives": [
        {
          "text": "what they could have said instead",
          "explanation": "why this would be more effective",
          "predicted_outcome": "what would likely happen next if this was said"
        }
      ]
    }
  ]
}

CATEGORY DEFINITIONS:
- Best: Optimal communication. Clear, empathetic, advances the conversation.
- Strong: Very effective. Minor improvements possible but overall excellent.
- Good: Adequate communication. Gets the point across but could be refined.
- Unclear: Message is ambiguous or lacks precision.
- Missed Opportunity: Something important could have been said but was not.
- Risky: The statement could backfire depending on how it is received.
- Misread Signal: The speaker misinterpreted the other person's intent or emotion.
- Escalation: The statement increased tension or conflict unnecessarily.
- Blunder: Clearly counterproductive. Damages trust, clarity, or the relationship.

RULES:
- Every turn must have a category.
- ONLY evaluate the user's speech (typically labeled "Me") for mistakes (Missed Opportunity, Risky, Misread Signal, Escalation, or Blunder) and mark as is_key_moment=true.
- For the other person's speech (typically labeled "Them"), NEVER mark it as a mistake or blunder, and NEVER provide alternatives. Set its category to "Good", "Strong", or "Best" depending on clarity, is_key_moment=false, and alternatives=[].
- Mark the user's turns as is_key_moment=true if they are Best, Missed Opportunity, Risky, Misread Signal, Escalation, or Blunder.
- Only provide alternatives (non-empty array) for the user's turns categorized as Unclear, Missed Opportunity, Risky, Misread Signal, Escalation, or Blunder.
- For turns categorized as Best, Strong, or Good, set alternatives to an empty array [].
- hidden_meaning should be null for straightforward statements.
- Be specific in your analysis. Reference the actual words used.
- The explanation field should clearly state why this moment helped or hurt the conversation.
- SCORING: Do NOT be overly harsh. A normal, polite, functional conversation with no major blunders should score between 70-90. Only score below 50 if there is severe conflict, unprofessionalism, or actively toxic behavior.`

const PRACTICE_SYSTEM_PROMPT = `You are evaluating a user's rewrite of a problematic conversation turn. Be encouraging but honest.

Given the original turn, conversation context, and the user's rewritten version, return a JSON object:

{
  "score": <number 0-100>,
  "improvement": "what got better compared to the original",
  "still_missing": "what could still be improved, or null if excellent",
  "predicted_outcome": "how the other person would likely respond to this rewrite",
  "tone_assessment": "the tone of the rewrite (e.g. calm, assertive, empathetic)"
}

Return ONLY valid JSON, no markdown.`

const STYLES_SYSTEM_PROMPT = `You generate alternative response styles for a conversation turn. Given the original problematic turn and conversation context, generate three different rewrites in different communication styles.

Return ONLY valid JSON:

{
  "calm": {
    "text": "a calm, measured, non-confrontational rewrite",
    "effect": "brief description of how this would land"
  },
  "direct": {
    "text": "a clear, assertive, straight-to-the-point rewrite",
    "effect": "brief description of how this would land"
  },
  "diplomatic": {
    "text": "a tactful, relationship-preserving rewrite that still gets the point across",
    "effect": "brief description of how this would land"
  }
}

Return ONLY valid JSON, no markdown.`

const LIVE_SYSTEM_PROMPT = `You are a real-time conversation assistant helping a user during a live call. Respond with a BRIEF JSON object. Be fast and highly sensitive to subtle conversational cues.

CRITICAL INSTRUCTIONS FOR SENSITIVITY & TONE:
1. Detect hesitation immediately (filler words like "um", pauses, trailing off, silence).
2. Detect tension and defensiveness (sudden quietness, short answers, subtle shifts in agreement, passive aggression).
3. The "suggested_reply" and "meaning" must sound deeply human, natural, context-aware, and conversational. Do not sound robotic, formal, or over-explain. The reply should feel like genuine human empathy or clarification, something a real person would say in the moment.

Your entire answer must be one JSON object only. No text before { or after }. No markdown fences. Return ONLY valid JSON:

{
  "emotional_tone": "one word (e.g., hesitant, defensive, engaged)",
  "intent": "brief phrase",
  "hidden_meaning": "subtext if any, or null if straightforward",
  "meaning": "1 short, conversational sentence explaining what they actually mean or what's happening beneath the surface.",
  "tension_level": <number 1-10>,
  "suggested_reply": "1-2 natural, human sentences the user can read verbatim as their reply. E.g., 'It sounds like you have some concerns...' rather than 'I acknowledge your hesitation.' Do not use quotation marks.",
  "alert": "null or a short alert like 'hesitation detected', 'tension rising', 'passive disagreement'"
}`

/** Pull out a balanced {...} object from model text (handles prose before/after JSON). */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (c === '\\' && inString) {
      escape = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function parseJSON(text: string): any {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  let candidate = fence ? fence[1].trim() : text.trim()

  try {
    return JSON.parse(candidate)
  } catch {
    const extracted = extractJsonObject(candidate)
    if (extracted) {
      return JSON.parse(extracted)
    }
    throw new Error(`Model did not return valid JSON (starts with: ${candidate.slice(0, 80).replace(/\s+/g, ' ')}…)`)
  }
}

async function callOpenRouter(
  systemPrompt: string,
  userMessage: string,
  fast = false,
  jsonObjectMode = false
): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not set — add it to your .env file')
  }
  console.log('[Flowra] Calling OpenRouter API...')

  const body: Record<string, unknown> = {
    model: fast ? 'google/gemini-2.5-flash' : 'google/gemini-2.5-pro',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_tokens: fast ? 512 : 8192,
    temperature: 0.2
  }

  if (jsonObjectMode) {
    body.response_format = { type: 'json_object' }
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://flowra.app',
      'X-Title': 'Flowra'
    },
    body: JSON.stringify(body)
  })

  console.log('[Flowra] API response status:', response.status)

  if (!response.ok) {
    const errText = await response.text()
    console.error('[Flowra] API error:', errText)
    throw new Error(`API error ${response.status}: ${errText}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

const activeAbortControllers = new Map<string, Set<AbortController>>()

export function handleAbortSession(sessionId: string) {
  const controllers = activeAbortControllers.get(sessionId)
  if (controllers) {
    console.log(`[Flowra] Aborting ${controllers.size} pending transcriptions for session ${sessionId}`)
    for (const controller of Array.from(controllers)) {
      controller.abort()
    }
    activeAbortControllers.delete(sessionId)
  }
}

export async function handleAnalyze(text: string): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const raw = await callOpenRouter(ANALYSIS_SYSTEM_PROMPT, `Analyze this conversation:\n\n${text}`, false, true)
    const data = parseJSON(raw)

    const categoryCounts: Record<string, number> = {}
    for (const turn of data.turns) {
      categoryCounts[turn.category] = (categoryCounts[turn.category] || 0) + 1
    }
    data.category_counts = categoryCounts
    data.turn_count = data.turns.length

    return { success: true, data }
  } catch (err: any) {
    console.error('Analysis error:', err)
    return { success: false, error: err.message }
  }
}

export async function handlePractice(
  originalTurn: string,
  context: string,
  rewrite: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const userMessage = `Original turn: "${originalTurn}"\n\nConversation context: ${context}\n\nUser's rewrite: "${rewrite}"`
    const raw = await callOpenRouter(PRACTICE_SYSTEM_PROMPT, userMessage)
    const data = parseJSON(raw)
    return { success: true, data }
  } catch (err: any) {
    console.error('Practice evaluation error:', err)
    return { success: false, error: err.message }
  }
}

export async function handleGenerateStyles(
  originalTurn: string,
  context: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const userMessage = `Original turn: "${originalTurn}"\n\nConversation context: ${context}`
    const raw = await callOpenRouter(STYLES_SYSTEM_PROMPT, userMessage)
    const data = parseJSON(raw)
    return { success: true, data }
  } catch (err: any) {
    console.error('Style generation error:', err)
    return { success: false, error: err.message }
  }
}

function normalizeLiveInsight(data: Record<string, unknown>): Record<string, unknown> {
  const suggested =
    (typeof data.suggested_reply === 'string' && data.suggested_reply) ||
    (typeof data.suggestion === 'string' && data.suggestion) ||
    ''
  let meaning =
    (typeof data.meaning === 'string' && data.meaning.trim()) ||
    (typeof data.hidden_meaning === 'string' && data.hidden_meaning.trim()) ||
    null
  if (!meaning && typeof data.intent === 'string' && data.intent.trim()) {
    meaning = `They're driving at: ${data.intent.trim()}`
  }
  return {
    ...data,
    suggestion: suggested,
    meaning
  }
}

export async function handleLiveAnalyze(
  conversationSoFar: string,
  latestMessage: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const userMessage = `Conversation so far:\n${conversationSoFar}\n\nAnalyze the latest message: "${latestMessage}"`
    let raw: string

    // Use cached knowledge of whether json_object mode works to avoid
    // the double-request penalty on every single live analysis call.
    const useJsonMode = jsonObjectSupported !== false

    try {
      raw = await callOpenRouter(LIVE_SYSTEM_PROMPT, userMessage, true, useJsonMode)
      // If we got here with json mode on, it's supported
      if (useJsonMode && jsonObjectSupported === null) {
        jsonObjectSupported = true
        console.log('[Flowra] json_object response_format confirmed supported')
      }
    } catch (e: any) {
      // Only retry if we were using json mode and it's the cause of the failure
      if (useJsonMode && jsonObjectSupported === null) {
        console.warn('[Flowra] Live analyze: json_object failed, caching result and retrying without it', e.message)
        jsonObjectSupported = false
        raw = await callOpenRouter(LIVE_SYSTEM_PROMPT, userMessage, true, false)
      } else {
        throw e
      }
    }
    const data = normalizeLiveInsight(parseJSON(raw) as Record<string, unknown>)
    return { success: true, data }
  } catch (err: any) {
    console.error('Live analysis error:', err)
    return { success: false, error: err.message }
  }
}

export async function handleTranscribeAudio(
  base64Audio: string,
  mimeType: string,
  meta?: {
    sessionId?: string
    segmentId?: string
    trackType?: 'mic' | 'system'
    durationMs?: number
    payloadHash?: string
    providerHint?: string
    languageHint?: string
  }
): Promise<{
  success: boolean
  data?: {
    segments: Array<{ speaker: string; text: string }>
    provider?: string
    confidence?: number
  }
  error?: string
}> {
  try {
    const apiKey = getApiKey()
    if (!apiKey) {
      return { success: false, error: 'OPENROUTER_API_KEY not set' }
    }

    console.log('[Flowra] Transcribing audio via OpenRouter...', {
      sessionId: meta?.sessionId,
      segmentId: meta?.segmentId,
      trackType: meta?.trackType,
      durationMs: meta?.durationMs,
      payloadHash: meta?.payloadHash
    })

    const audioFormat = mimeType.includes('mp3') ? 'mp3' : 'wav'
    const sessionId = meta?.sessionId || 'unknown'
    const abortController = new AbortController()

    if (sessionId !== 'unknown') {
      if (!activeAbortControllers.has(sessionId)) {
        activeAbortControllers.set(sessionId, new Set())
      }
      activeAbortControllers.get(sessionId)!.add(abortController)
    }

    const requestTranscription = async (model: string): Promise<{ ok: boolean; status: number; errText?: string; data?: any }> => {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: abortController.signal,
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://flowra.app',
            'X-Title': 'Flowra'
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: `You are a strict, literal English audio transcription engine.

CRITICAL RULES:
1. Transcribe ONLY words you can CLEARLY and CONFIDENTLY hear. If you are not sure, output [silence].
2. If the audio contains silence, background noise, music, typing, breathing, or any non-speech sounds, output ONLY: [silence]
3. NEVER fabricate, guess, or invent speech. If you cannot make out clear words, output [silence].
4. NEVER repeat the same phrase if you only hear it once.
5. Do NOT censor profanity — write exactly what is spoken.
6. Transcribe modern slang and colloquialisms as-is.
7. Output ONLY the transcript text or [silence]. No commentary, no explanations.

When in doubt, ALWAYS choose [silence] over guessing.`
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'input_audio',
                    input_audio: {
                      data: base64Audio,
                      format: audioFormat
                    }
                  },
                  {
                    type: 'text',
                    text: `Transcribe the speech in this audio exactly as spoken. Output only the transcript text. If no speech, output [silence].${meta?.languageHint ? ` Language hint: ${meta.languageHint}.` : ''}`
                  }
                ]
              }
            ],
            max_tokens: 200,
            temperature: 0
          })
        })

        if (!response.ok) {
          const errText = await response.text()
          console.error(`[Flowra] Transcription request failed (${model}):`, response.status, errText)
          return { ok: false, status: response.status, errText }
        }

        const data = await response.json()
        return { ok: true, status: response.status, data }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return { ok: true, status: 499, data: { choices: [{ message: { content: '[silence]' } }] } } // Return silence if aborted
        }
        throw err
      } finally {
        if (sessionId !== 'unknown') {
          activeAbortControllers.get(sessionId)?.delete(abortController)
        }
      }
    }

    let modelUsed = 'google/gemini-2.5-flash'
    let transcribeResult = await requestTranscription(modelUsed)

    if (!transcribeResult.ok) {
      console.warn(`[Flowra] ${modelUsed} failed (${transcribeResult.status}), retrying with xiaomi/mimo-v2-omni`)
      modelUsed = 'xiaomi/mimo-v2-omni'
      transcribeResult = await requestTranscription(modelUsed)
    }

    if (!transcribeResult.ok) {
      console.error('[Flowra] Transcription API error:', transcribeResult.status, transcribeResult.errText)
      throw new Error(`Transcription API ${transcribeResult.status}`)
    }

    const transcription = (transcribeResult.data?.choices?.[0]?.message?.content || '').trim()
    console.log(`[Flowra] Transcription result (${modelUsed}):`, transcription)

    // Filter out silence/empty responses
    if (!transcription || transcription.length < 2 ||
        transcription.toLowerCase().includes('[silence]') ||
        transcription.toLowerCase().includes('no speech') ||
        transcription.toLowerCase().includes('no audio') ||
        transcription.toLowerCase().includes('no clear speech')) {
      return { success: true, data: { segments: [], provider: modelUsed } }
    }

    // ── Hallucination detection ──
    // Only catch cases where the model clearly failed to process audio and
    // responded with meta-commentary about the task itself. Previous patterns
    // like /I (will|can|would)/ matched real speech ("I can help with that").
    const hallucinationPatterns = [
      /please (?:provide|upload|share|send).*(?:audio|file|clip|recording)/i,
      /upload.*(?:audio|file|clip)/i,
      /once you (?:upload|provide|share)/i,
      /(?:audio|file|clip|recording).*(?:not (?:found|provided|received|attached))/i,
      /provide (?:the|a|an) (?:audio|file|clip)/i,
      /link the file/i,
      /I'm (?:sorry|unable),? (?:but )?I (?:cannot|can't|don't) (?:hear|process|access|find)/i,
      /no audio (?:file|content|data|input) (?:was |has been )?(?:provided|found|received|detected)/i,
      /I (?:cannot|can't) (?:hear|process|access|listen to) (?:the |any )?audio/i,
      /transcription (?:system|engine|test|quality)/i,
      /the (?:audio|recording) (?:contains|features|includes|appears to (?:be|contain))/i,
    ]

    const isHallucination = hallucinationPatterns.some(pattern => pattern.test(transcription))
    if (isHallucination) {
      console.log('[Flowra] Detected hallucinated/meta response, discarding:', transcription.substring(0, 120))
      return { success: true, data: { segments: [], provider: modelUsed } }
    }

    // Parse speaker-labeled output into segments
    const segments: Array<{ speaker: string; text: string }> = []
    const lines = transcription.split('\n').filter((l: string) => l.trim())

    for (const line of lines) {
      const match = line.match(/^(?:Speaker\s*(\d+)|(\w+))\s*:\s*(.+)/i)
      if (match) {
        const speakerNum = match[1] || match[2]
        const text = match[3].trim()
        if (text) {
          segments.push({ speaker: `Speaker ${speakerNum}`, text })
        }
      } else if (line.trim() && !line.startsWith('[')) {
        // No speaker label — treat as continuation of previous speaker or single speaker
        segments.push({ speaker: 'Speaker 1', text: line.trim() })
      }
    }

    // If no segments parsed, treat whole thing as single speaker
    if (segments.length === 0 && transcription.length > 2) {
      segments.push({ speaker: 'Speaker 1', text: transcription })
    }

    return { success: true, data: { segments, provider: modelUsed } }
  } catch (err: any) {
    console.error('[Flowra] Transcription error:', err)
    return { success: false, error: err.message }
  }
}

export function handleParseTranscript(rawText: string): { success: boolean; data?: string; error?: string } {
  try {
    // Detect and normalize common transcript formats
    let normalized = rawText

    // Zoom format: "HH:MM:SS Speaker Name: text"
    normalized = normalized.replace(/^\d{2}:\d{2}:\d{2}\s+/gm, '')

    // Teams format: "[HH:MM:SS] Speaker Name\ntext" -> "Speaker Name: text"
    normalized = normalized.replace(/\[(\d{2}:\d{2}(?::\d{2})?)\]\s*\n?/g, '')

    // Google Meet / Otter.ai: "Speaker Name  HH:MM\ntext" -> "Speaker Name: text"
    normalized = normalized.replace(/^([A-Za-z\s]+)\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/gm, '$1:')

    // VTT format: remove WEBVTT header and timestamps
    normalized = normalized.replace(/^WEBVTT[\s\S]*?\n\n/i, '')
    normalized = normalized.replace(/^\d+\n\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\n/gm, '')

    // SRT format: remove sequence numbers and timestamps
    normalized = normalized.replace(/^\d+\n\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}\n/gm, '')

    // Clean up excessive blank lines
    normalized = normalized.replace(/\n{3,}/g, '\n\n')

    // If lines don't have speaker labels, try to detect them
    const lines = normalized.split('\n').filter(l => l.trim())
    const hasLabels = lines.some(l => /^[A-Za-z\s]+:/.test(l))

    if (!hasLabels && lines.length > 1) {
      // Assume alternating speakers
      normalized = lines.map((line, i) =>
        `Speaker ${i % 2 === 0 ? 'A' : 'B'}: ${line.trim()}`
      ).join('\n')
    }

    return { success: true, data: normalized.trim() }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
