# Flowra Live Assist Framework v2

## 1. Purpose

Flowra Live Assist should do one job well:

**capture live conversation audio, detect real speech conservatively, transcribe it reliably, and only then produce small actionable guidance.**

The previous framework was fragile because it combined:

- fixed-threshold VAD
- rigid 1-second chunking
- multimodal model transcription as first-pass ASR
- post-hoc hallucination cleanup

That design makes the system swing between:

- missing speech completely
- sending noise to the model
- getting plausible but fake transcripts
- overloading the UI with junk output

The revised framework fixes this by making the pipeline **acoustically conservative first** and **AI interpretive second**.

---

## 2. Core Design Principles

### A. The model should not decide whether audio is speech
Speech detection must happen in the audio layer, not in the transcription model.

### B. Segment by utterance, not by fixed time slices
Humans do not speak in perfect 1000 ms windows. The system should detect a speech event and capture the entire utterance.

### C. Adaptive thresholds are mandatory
Mic audio and desktop audio have different levels, different noise floors, and different browser processing. One hardcoded RMS threshold will never be stable enough.

### D. Transcription and communication analysis are separate jobs
Use a speech-to-text model to produce words.
Use a reasoning/analysis model to interpret those words.

### E. Live Assist must be conservative
It is better to miss a small amount of questionable speech than to flood the user with hallucinated live transcripts.

### F. Guardrails should support the pipeline, not rescue it
Repeat filters and hallucination suppression should remain, but only as a final cleanup layer after reliable audio segmentation and transcription.

### G. Speaker separation is a first-class concern
The mic track and system track should be processed independently for calibration, VAD, segmentation, and labeling.

---

## 3. High-Level System Architecture

## Live Assist v2 pipeline

```text
Mic Audio --------\
                   -> Capture Layer -> Preprocessing -> Adaptive VAD -> Utterance Builder
System Audio ----/                                                  |
                                                                  Valid Speech Segments
                                                                          |
                                                                          v
                                                                Transcription Layer
                                                                          |
                                                                          v
                                                              Transcript Guardrail Layer
                                                                          |
                                                                          v
                                                               Speaker / Timeline Layer
                                                                          |
                                                                          v
                                                            Live Assist Insight Generator
                                                                          |
                                                                          v
                                                                   UI + Session Log
```

### The architecture is split into 8 layers:

1. Capture Layer
2. Preprocessing Layer
3. Adaptive VAD Layer
4. Utterance Builder
5. Transcription Layer
6. Transcript Guardrail Layer
7. Speaker / Timeline Layer
8. Insight + UI Layer

---

## 4. Layer 1: Capture Layer

The capture layer is responsible for obtaining two separate audio streams:

- **Mic Track** = user’s own voice
- **System Track** = the other participants / meeting audio

### 4.1 Mic capture
Use `getUserMedia()` for the microphone stream.

### 4.2 System / desktop capture
Use `getDisplayMedia()` with audio enabled and video enabled, then discard the video track immediately after capture.

### 4.3 Capture rules

- Capture mic and system tracks independently
- Keep them logically separate throughout the pipeline
- Do not mix them before VAD
- Each track gets its own calibration and thresholds
- Treat track failure independently so the session can continue if one source is unavailable

### 4.4 Recommended constraints

#### Mic track
Use these as a starting point, then tune per device:

```ts
const micStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1
  }
})
```

#### System track

```ts
const displayStream = await navigator.mediaDevices.getDisplayMedia({
  video: true,
  audio: true
})

displayStream.getVideoTracks().forEach(track => track.stop())
const systemAudioTracks = displayStream.getAudioTracks()
```

### 4.5 Track metadata to store
For both tracks, store:

- source type (`mic` or `system`)
- browser-reported track settings
- device label if available
- sample rate if available
- channel count
- whether echo cancellation / suppression / auto gain are active

### 4.6 Failure handling
If system audio is unavailable:
- continue with mic-only mode
- warn the user that other participants may not be captured

If mic audio is unavailable:
- continue with listen-only mode if the product allows it
- label clearly in UI

---

## 5. Layer 2: Preprocessing Layer

Before VAD, each track should go through lightweight preprocessing.

### 5.1 Convert to mono
For VAD, stereo is unnecessary. Convert to mono to reduce complexity and normalize behavior.

### 5.2 High-pass filter
Apply a high-pass filter around **70–100 Hz** to reduce low-frequency rumble, fan noise, handling noise, and desk vibration.

### 5.3 Optional low-pass smoothing
Optionally apply a mild low-pass filter above the speech band only if testing shows harsh high-frequency artifacts are causing false triggers.

### 5.4 Optional mild gain normalization
Do not aggressively normalize in a way that destroys relative energy differences. Mild normalization is acceptable, but VAD adaptation should rely primarily on noise-floor tracking.

### 5.5 Single AudioContext per session
Use one `AudioContext` per live session and create separate source chains for mic and system tracks.

### 5.6 Use AudioWorklet, not ScriptProcessorNode
All frame-level VAD logic should run inside an `AudioWorkletProcessor`.

### 5.7 Recommended processing graph

```text
MediaStreamSource
   -> BiquadFilterNode(highpass)
   -> mono combine if needed
   -> AudioWorkletNode(vad-processor)
```

### 5.8 Worklet output policy
The worklet should not stream every frame back to the UI thread.
It should only post compact state updates such as:

- frame RMS sample (optional, throttled)
- noise floor update (throttled)
- speech start event
- speech end event
- current speech state

---

## 6. Layer 3: Adaptive VAD Layer

This is the heart of the new framework.

The old VAD logic was too brittle because it depended on one fixed RMS threshold and triggered on one active frame.

### 6.1 Goals of VAD
The VAD layer should answer only these questions:

- Is this track currently in speech?
- Did speech just start?
- Did speech just stop?
- Was the detected speech long enough to keep?

### 6.2 VAD engine choice
Use an `AudioWorkletProcessor` so frame-level analysis happens off the main UI thread.

### 6.3 Base signal feature
Start with RMS-based energy detection because it is efficient and easy to maintain.

Use:

- rolling RMS
- rolling noise floor estimate
- separate start and stop thresholds
- consecutive-frame counters
- minimum speech duration

### 6.4 Frame duration
Use **20 ms frames**.

This gives a good balance between:
- low latency
- stable statistics
- manageable worklet message volume

### 6.5 Noise-floor calibration
At the start of the session, spend **1.5 seconds** calibrating each track independently.

For each track:
- collect frame RMS values
- compute median or low-percentile RMS
- set that as `noiseFloor`

This should happen separately for:
- mic track
- system track

### 6.6 Dynamic thresholds
Do not use one fixed RMS threshold.

Use:

```ts
startThreshold = Math.max(noiseFloor * 3.0, 0.0012)
stopThreshold = Math.max(noiseFloor * 1.8, 0.0006)
```

These are starting values, not permanent truth.

### 6.7 Hysteresis
Use two thresholds:

- `startThreshold` for entering speech
- `stopThreshold` for leaving speech

This prevents the state from chattering around the boundary.

### 6.8 Consecutive-frame rules
Require multiple consecutive active frames before speech begins.
Require multiple consecutive inactive frames before speech ends.

Recommended defaults:

```ts
FRAME_MS = 20
CALIBRATION_MS = 1500

START_FRAMES = 6      // ~120 ms above threshold to start
STOP_FRAMES = 20      // ~400 ms below threshold to stop

MIN_SPEECH_MS = 300
PREFIX_MS = 250
MAX_UTTERANCE_MS = 8000
```

### 6.9 State machine
Each track runs its own VAD state machine:

- `CALIBRATING`
- `IDLE`
- `PRE_SPEECH`
- `IN_SPEECH`
- `POST_SPEECH`

#### State definitions

**CALIBRATING**
- collect background RMS values
- do not emit speech

**IDLE**
- no speech is active
- maintain rolling noise floor

**PRE_SPEECH**
- one or more high-energy frames observed
- wait until `START_FRAMES` is satisfied
- cancel if energy falls back down

**IN_SPEECH**
- speech is active
- buffer all audio for utterance assembly

**POST_SPEECH**
- energy has fallen below stop threshold
- wait until `STOP_FRAMES` is satisfied
- if energy rises again, return to `IN_SPEECH`
- if silence persists, finalize utterance

### 6.10 Noise floor tracking during session
Noise changes during a call, so the floor should update slowly when not in speech.

Recommended rule:
- only update noise floor while in `IDLE`
- do not update noise floor while `IN_SPEECH`
- use a slow exponential moving average or rolling percentile

### 6.11 Per-track separation
Mic and system audio must not share thresholds.

Possible real-world behavior:
- quiet mic in a silent room
- loud meeting audio from speakers
- compressed desktop stream
- laptop fan noise only on mic

These must be treated independently.

---

## 7. Layer 4: Utterance Builder

The utterance builder replaces the old fixed 1000 ms slicing design.

### 7.1 Why fixed chunking fails
The old approach asked every second:

> “Did anyone speak during this second?”

This causes:
- clipped beginnings
- clipped endings
- short noise fragments sent as speech
- many tiny chunks with almost no usable phonetic content
- more hallucinations from the transcription model

### 7.2 New design: utterance-based segmentation
Instead of fixed windows, build segments around actual speech events.

### 7.3 Components of the utterance builder
Each track should have:

- a rolling preroll buffer
- an active utterance buffer
- silence counters
- duration limits
- finalization rules

### 7.4 Rolling preroll buffer
Maintain a circular buffer of the last **250 ms** of audio.

When speech starts:
- prepend the preroll buffer to the utterance

This prevents word beginnings from being cut off.

### 7.5 Start behavior
When VAD enters `IN_SPEECH`:
- create a new utterance
- include the preroll audio
- start recording contiguous speech frames

### 7.6 End behavior
When VAD falls below the stop threshold:
- do not end immediately
- wait until `STOP_FRAMES` worth of silence is observed
- then finalize the utterance

### 7.7 Minimum utterance duration
Discard any utterance shorter than **300 ms**.

These are usually:
- clicks
- keyboard taps
- mic bumps
- breaths
- tiny audio glitches

### 7.8 Maximum utterance duration
Cap utterances at **8 seconds**.

If continuous speech exceeds that limit:
- finalize safely at the nearest silence if possible
- otherwise split and continue

### 7.9 Segment metadata
Each finalized utterance should include:

- track type (`mic` or `system`)
- segment id
- session id
- start timestamp
- end timestamp
- duration ms
- average RMS
- peak RMS
- estimated noise floor at capture time
- whether it passed minimum-speech validation

### 7.10 Validation before transcription
Reject segment before API if:

- duration < 300 ms
- PCM is empty or all zeros
- sample count is invalid
- file size is suspiciously tiny
- average RMS barely exceeds the stop threshold
- decode / repack step failed

---

## 8. Layer 5: Transcription Layer

This layer converts validated speech segments into text.

### 8.1 Separate transcription from reasoning
The first-pass model should be a dedicated speech-to-text model, not a general multimodal chat model.

### 8.2 Correct pipeline
Use:

```text
audio -> transcription model -> transcript text -> analysis model
```

Do not use:

```text
audio -> reasoning model pretending to be ASR -> transcript
```

### 8.3 Why this matters
Reasoning models may try to be helpful on noisy input and produce plausible text even when the audio is meaningless.

Speech-to-text models are better aligned for:
- literal transcription
- handling incomplete phonetic evidence
- suppressing imaginative completions
- timestamp-friendly output

### 8.4 Input format strategy
Preferred order:

1. send the segment in the provider’s native supported audio format
2. only convert to WAV if the selected provider requires WAV

### 8.5 Encoding strategy
For each segment:
- keep raw PCM if needed internally
- generate the provider-required format once
- store a hash of the final payload for dedupe / debugging

### 8.6 Transcription request contract
Every transcription call should include:

- session id
- segment id
- track type
- audio payload
- declared audio format
- optional language hint if known

### 8.7 Latency policy
Live Assist needs near-real-time behavior but should not sacrifice reliability.

Target:
- utterance completes
- upload begins immediately
- transcript returns quickly enough for ongoing UI support

### 8.8 Retry policy
If transcription fails:

#### Retry once if
- network failure
- transient provider error
- timeout

#### Do not retry if
- audio payload is invalid
- decode or repack failed locally
- provider says the audio is corrupted and local validation agrees

### 8.9 Provider fallback
If primary STT provider fails transiently:
- retry on fallback STT provider
- preserve the same segment id
- label provider used for diagnostics

### 8.10 Empty result handling
If transcription returns:
- empty string
- whitespace only
- explicit silence token

then mark the segment as `no_transcript` and do not forward it to live analysis.

---

## 9. Layer 6: Transcript Guardrail Layer

This layer cleans transcript results before they enter the live conversation log.

### 9.1 Purpose
The goal is not to invent corrections.
The goal is to suppress garbage and protect the UI.

### 9.2 Guardrail checks
For each returned transcript, run:

- trim whitespace
- normalize repeated spaces
- normalize punctuation lightly
- reject if empty
- reject if known hallucination phrase
- reject if repeated too many times in a short window
- reject if transcript length is implausible for audio duration

### 9.3 Known hallucination blacklist
Maintain a list of common junk phrases seen during testing.

Examples:
- “hello, how are you?”
- “i’m not sure what you’re talking about”
- “please provide the file”
- any provider-specific repeated boilerplate your logs reveal

This list should be configurable and telemetry-backed.

### 9.4 Repeat-window suppression
If the exact same short phrase repeats repeatedly for the same track over a short span, suppress it.

Recommended rule:
- keep the last 5 accepted / rejected transcripts per track
- if the same short phrase appears 3 or 4 times in a row with similar audio stats, suppress future repeats for a cooldown window

### 9.5 Audio-length sanity check
Reject transcripts that are too dense for the audio length.

Example heuristics:
- 300 ms audio should not produce a long sentence
- 500 ms audio should not produce 12 words confidently

### 9.6 Optional low-confidence routing
If the STT provider gives confidence or no-speech probability:
- reject very low-confidence segments
- or mark them as tentative and do not surface them in live UI

### 9.7 Output states
Each segment leaves the guardrail layer in one of these states:

- `accepted`
- `rejected_silence`
- `rejected_blacklist`
- `rejected_repeat`
- `rejected_invalid_length`
- `rejected_corrupt_audio`
- `rejected_empty`
- `tentative`

---

## 10. Layer 7: Speaker / Timeline Layer

This layer converts accepted transcript segments into conversation turns.

### 10.1 Speaker assignment
Speaker is determined primarily by track origin:

- mic track -> `You`
- system track -> `Them`

### 10.2 Timeline ordering
All accepted transcript segments are merged into one session timeline using:

- utterance start time
- utterance end time
- ingestion order as tie-breaker

### 10.3 Turn schema
Each live turn should include:

- turn id
- session id
- speaker label
- source track
- transcript text
- start timestamp
- end timestamp
- duration ms
- transcript provider
- confidence or quality flags if available
- raw audio segment id

### 10.4 Overlap handling
If both tracks contain speech during overlapping windows:
- keep both turns
- preserve timing overlap in raw session data
- surface overlap carefully in UI if needed

### 10.5 Partial consolidation
If two accepted segments from the same speaker are very close together and clearly belong to one short thought, optionally merge them before analysis.

Recommended merge condition:
- same speaker
- gap < 400 ms
- total combined duration still small
- no conflicting analysis already attached

---

## 11. Layer 8: Insight + UI Layer

This is where Flowra becomes Flowra.

The insight layer should only consume **accepted transcript text**, not raw audio.

### 11.1 Live Assist output policy
Live Assist must remain:
- short
- subtle
- actionable
- low-noise

### 11.2 What the live model should do
Based on recent accepted turns, infer:

- likely intent
- tension level
- hesitation
- disagreement risk
- confusion risk
- best next move

### 11.3 What the live model should not do
Do not:
- rewrite every sentence live
- produce long explanations while the user is in the call
- act highly confident on ambiguous snippets
- generate advice from tentative or rejected segments

### 11.4 Recommended live outputs
Examples:
- “hidden disagreement”
- “ask for specifics”
- “they seem unconvinced”
- “summarize before responding”
- “acknowledge concern first”
- “tension rising”

### 11.5 Insight generation trigger
Do not run full analysis on every accepted segment individually.

Instead, run when:
- a meaningful new turn is added
- at least one side responded
- enough recent context exists
- cooldown window has passed

### 11.6 Cooldown rules
Prevent UI flicker with a small analysis cooldown.

Example:
- at most one visible new insight every 2–4 seconds unless a major event is detected

### 11.7 Confidence handling
If the system is uncertain:
- reduce specificity
- avoid strong claims
- prefer soft labels like “possible hesitation” over “they are definitely defensive”

### 11.8 Session log storage
Store:
- all accepted transcript turns
- rejected-segment metadata for debugging
- live insights shown
- timestamps of displayed suggestions

---

## 12. Reference State Machine

## 12.1 Per-track VAD state machine

```text
CALIBRATING
   -> IDLE

IDLE
   -> PRE_SPEECH      when RMS > startThreshold

PRE_SPEECH
   -> IN_SPEECH       when activeFrames >= START_FRAMES
   -> IDLE            when energy falls back below threshold early

IN_SPEECH
   -> POST_SPEECH     when RMS < stopThreshold
   -> IN_SPEECH       while speech continues

POST_SPEECH
   -> IN_SPEECH       if speech resumes before STOP_FRAMES satisfied
   -> IDLE            when inactiveFrames >= STOP_FRAMES and utterance finalized
```

## 12.2 Segment lifecycle

```text
track audio -> preprocess -> VAD active -> open utterance -> append frames
-> speech ends -> finalize utterance -> validate -> transcribe
-> guardrails -> accepted turn OR rejected segment
```

---

## 13. Suggested Default Configuration

These are starting defaults, not final truths.

```ts
export const LIVE_ASSIST_CONFIG = {
  frameMs: 20,
  calibrationMs: 1500,
  prefixMs: 250,
  minSpeechMs: 300,
  maxUtteranceMs: 8000,
  startFrames: 6,
  stopFrames: 20,
  minStartThreshold: 0.0012,
  minStopThreshold: 0.0006,
  startMultiplier: 3.0,
  stopMultiplier: 1.8,
  repeatWindowSize: 5,
  repeatCooldownMs: 8000,
  mergeGapMs: 400,
  liveInsightCooldownMs: 3000
}
```

### Derived thresholds per track

```ts
startThreshold = Math.max(noiseFloor * startMultiplier, minStartThreshold)
stopThreshold = Math.max(noiseFloor * stopMultiplier, minStopThreshold)
```

---

## 14. Pseudocode Framework

## 14.1 Session initialization

```ts
async function startLiveAssistSession() {
  const sessionId = createSessionId()

  const micStream = await getMicStream()
  const systemStream = await getSystemStream()

  const audioContext = new AudioContext()

  const micPipeline = await createTrackPipeline({
    sessionId,
    trackType: 'mic',
    stream: micStream,
    audioContext
  })

  const systemPipeline = await createTrackPipeline({
    sessionId,
    trackType: 'system',
    stream: systemStream,
    audioContext
  })

  return {
    sessionId,
    audioContext,
    micPipeline,
    systemPipeline,
    startedAt: Date.now()
  }
}
```

## 14.2 Track pipeline creation

```ts
async function createTrackPipeline({ sessionId, trackType, stream, audioContext }) {
  const source = audioContext.createMediaStreamSource(stream)
  const highpass = audioContext.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = 80

  const vadNode = await createVadWorkletNode(audioContext, {
    trackType,
    sessionId
  })

  source.connect(highpass)
  highpass.connect(vadNode)

  const utteranceBuilder = createUtteranceBuilder({ sessionId, trackType })

  vadNode.port.onmessage = (event) => {
    handleVadEvent(event.data, utteranceBuilder)
  }

  return { source, highpass, vadNode, utteranceBuilder }
}
```

## 14.3 VAD event handling

```ts
function handleVadEvent(event, utteranceBuilder) {
  switch (event.type) {
    case 'frame':
      utteranceBuilder.pushFrame(event)
      break
    case 'speech_start':
      utteranceBuilder.startUtterance(event)
      break
    case 'speech_end':
      utteranceBuilder.endUtterance(event)
      break
    case 'noise_floor':
      updateTrackDiagnostics(event)
      break
  }
}
```

## 14.4 Finalization and transcription

```ts
async function finalizeUtterance(segment) {
  if (!validateSegment(segment)) {
    recordRejectedSegment(segment, 'validation_failed')
    return
  }

  try {
    const transcriptResult = await transcribeSegment(segment)
    const cleaned = guardrailTranscript(segment, transcriptResult)

    if (!cleaned.accepted) {
      recordRejectedSegment(segment, cleaned.reason)
      return
    }

    const turn = createConversationTurn(segment, cleaned)
    appendTurnToTimeline(turn)
    maybeGenerateLiveInsight(turn)
  } catch (err) {
    recordTranscriptionFailure(segment, err)
  }
}
```

---

## 15. Detailed Validation Rules

### 15.1 Segment validation
Reject before transcription if any of the following are true:

- no audio samples present
- duration below `minSpeechMs`
- average RMS below minimum speech gate
- NaN values detected in PCM
- repack / encoding failed
- payload hash matches a recent rejected corrupt payload

### 15.2 Transcript validation
Reject after transcription if:

- transcript is empty
- transcript is only punctuation
- transcript matches blacklist
- transcript repeats too many times in a row
- transcript density is implausible for duration

### 15.3 Insight gating
Do not generate live insight if:

- transcript was tentative
- only one weak short fragment exists
- last visible insight was too recent
- context window is too small

---

## 16. Debugging and Telemetry Framework

This framework should be instrumented from day one.

### 16.1 Per-segment telemetry
Log:
- session id
- segment id
- track type
- start / end time
- duration
- avg RMS
- peak RMS
- noise floor
- start threshold
- stop threshold
- validation result
- transcription provider
- transcript result class

### 16.2 Counters to monitor
Track rates for:

- speech starts per minute
- finalized segments per minute
- rejected short segments
- rejected blacklisted transcripts
- repeated transcript suppressions
- provider failures
- corrupt payload failures
- accepted turns per minute

### 16.3 Diagnostic views for developers
Build an internal debug overlay showing:

- current VAD state per track
- current noise floor per track
- live RMS meter
- recent utterance durations
- accepted vs rejected segment counts
- last transcript reason for rejection

### 16.4 Debug export
Allow saving a session debug package with:

- metadata only by default
- optional audio samples in test builds
- per-track event logs
- transcript outcomes

---

## 17. Provider Strategy

### 17.1 Primary requirement
The primary transcription provider must be optimized for speech-to-text, not general chat completion.

### 17.2 Fallback requirement
Fallback should preserve:
- same audio segment
- same segment id
- same speaker label
- same timing

### 17.3 Provider abstraction contract
Define a provider adapter interface:

```ts
interface TranscriptionProvider {
  name: string
  transcribe(input: {
    segmentId: string
    audio: Blob | ArrayBuffer
    format: string
    languageHint?: string
  }): Promise<{
    text: string
    confidence?: number
    raw?: unknown
  }>
}
```

### 17.4 Avoid provider-specific business logic in the UI layer
Provider quirks should be normalized in the transcription adapter or guardrail layer.

---

## 18. Speaker Label Policy

### 18.1 Default labels
- mic track -> `You`
- system track -> `Them`

### 18.2 Future expansion
Later, you can add diarization or multi-speaker system separation, but it should not be required for the v2 framework.

### 18.3 Rule for ambiguous mixed audio
If system audio contains multiple people, keep them under `Them` for v2.
Do not pretend to know which remote participant spoke unless you actually have diarization support.

---

## 19. UI Behavior Rules

### 19.1 Transcript area
Show only accepted turns.
Do not show tentative or rejected transcripts in the user-facing live transcript.

### 19.2 Minimal disruption
Live Assist should never become a scrolling dump of low-value text.

### 19.3 Insight presentation
At any given moment, prioritize:
- one best next move
- one risk signal
- one interpretation cue

### 19.4 Latency tolerance
A slight delay is acceptable if it improves correctness.
Users will tolerate a short lag much better than frequent hallucinated live text.

### 19.5 Session completion
When session ends:
- stop both capture pipelines cleanly
- flush pending utterances if valid
- finalize session timeline
- make review-mode data available

---

## 20. Error Handling Policy

### 20.1 Capture errors
If user denies mic or system permission:
- continue with available source if possible
- explain limitation clearly

### 20.2 Audio context errors
If the `AudioContext` is suspended:
- attempt resume on user gesture
- surface a clear recovery action

### 20.3 Provider errors
Classify errors as:
- transient
- invalid audio
- unsupported format
- rate limit
- authentication / configuration

### 20.4 Safe failure behavior
When in doubt:
- reject the segment
- do not invent transcript text
- keep the UI calm

---

## 21. Rollout Plan

### Phase 1: Internal rebuild
Implement:
- AudioWorklet VAD
- adaptive thresholds
- utterance builder
- segment validation
- dedicated STT integration

### Phase 2: Guardrail hardening
Implement:
- blacklist management
- repeat suppression
- transcript density checks
- telemetry dashboards

### Phase 3: Live Assist tuning
Tune:
- VAD multipliers
- segment duration windows
- insight cooldowns
- merge rules

### Phase 4: Review integration
Ensure all accepted turns and metadata feed directly into Review Mode.

---

## 22. What Changes vs the Old Framework

## Remove
- fixed `VAD_RMS_THRESHOLD`
- `SPEECH_FRAME_THRESHOLD = 1`
- strict 1000 ms time slicing
- omni model as primary transcription engine
- dependence on post-hoc guardrails to rescue noisy input

## Add
- `AudioWorklet`-based VAD
- per-track calibration
- dynamic thresholds
- hysteresis
- utterance-based segmentation
- dedicated STT first pass
- transcript sanity checks tied to audio duration
- stronger telemetry

---

## 23. Final Decision Summary

Flowra should **keep its product framework** and **replace the Live Assist technical framework**.

### Keep
- Live Assist / Review split
- dual-track speaker concept
- real-time subtle guidance
- post-session learning and analysis

### Change
- capture processing implementation
- VAD architecture
- segmentation strategy
- transcription architecture
- transcript validation flow

### End result
The new framework is designed to produce:
- fewer missed utterances
- fewer random hallucinated transcripts
- cleaner speaker labeling
- fewer corrupted requests
- more stable real-time guidance

---

## 24. Recommended One-Sentence Internal Summary

**Flowra Live Assist v2 uses per-track adaptive VAD and utterance-based segmentation to send only validated speech to a dedicated transcription layer before any live reasoning or coaching occurs.**

