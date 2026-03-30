const FRAME_MS = 20
const MIN_START_THRESHOLD = 0.0012
const MIN_STOP_THRESHOLD = 0.0006
const START_MULTIPLIER = 3.0
const STOP_MULTIPLIER = 1.8
const DIAGNOSTIC_INTERVAL_MS = 200

const CALIBRATION_FRAMES = 1500 / FRAME_MS
const START_FRAMES = 6
const STOP_FRAMES = 20

class VADProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.trackType = options.processorOptions?.trackType || 'mic'
    this.sessionId = options.processorOptions?.sessionId || 'unknown'

    this.state = 'CALIBRATING'
    this.noiseFloor = 0.001
    this.startThreshold = MIN_START_THRESHOLD
    this.stopThreshold = MIN_STOP_THRESHOLD

    this.calibrationSamples = []
    this.activeFrames = 0
    this.inactiveFrames = 0
    this.lastDiagnosticSentMs = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true

    const channel = input[0]

    let sumSq = 0
    for (let i = 0; i < channel.length; i++) {
      sumSq += channel[i] * channel[i]
    }
    const rms = Math.sqrt(sumSq / channel.length)

    this.handleFrame(rms, channel)
    return true
  }

  handleFrame(rms, rawData) {
    const timestampMs = Math.round(currentTime * 1000)

    this.port.postMessage({
      type: 'frame',
      rms,
      state: this.state,
      trackType: this.trackType,
      noiseFloor: this.noiseFloor,
      startThreshold: this.startThreshold,
      stopThreshold: this.stopThreshold,
      timestampMs,
      data: rawData
    })

    if (timestampMs - this.lastDiagnosticSentMs >= DIAGNOSTIC_INTERVAL_MS) {
      this.lastDiagnosticSentMs = timestampMs
      this.port.postMessage({
        type: 'state',
        state: this.state,
        rms,
        trackType: this.trackType,
        noiseFloor: this.noiseFloor,
        startThreshold: this.startThreshold,
        stopThreshold: this.stopThreshold,
        timestampMs
      })
    }

    if (this.state === 'CALIBRATING') {
      this.calibrationSamples.push(rms)
      if (this.calibrationSamples.length >= CALIBRATION_FRAMES) {
        this.calibrationSamples.sort((a, b) => a - b)
        this.noiseFloor = this.calibrationSamples[Math.floor(this.calibrationSamples.length * 0.25)]
        this.updateThresholds()
        this.state = 'IDLE'
        this.port.postMessage({
          type: 'noise_floor',
          floor: this.noiseFloor,
          trackType: this.trackType,
          startThreshold: this.startThreshold,
          stopThreshold: this.stopThreshold,
          timestampMs
        })
      }
      return
    }

    if (this.state === 'IDLE') {
      if (rms > this.startThreshold) {
        this.state = 'PRE_SPEECH'
        this.activeFrames = 1
      } else {
        this.noiseFloor = this.noiseFloor * 0.99 + rms * 0.01
        this.updateThresholds()
      }
      return
    }

    if (this.state === 'PRE_SPEECH') {
      if (rms > this.startThreshold) {
        this.activeFrames += 1
        if (this.activeFrames >= START_FRAMES) {
          this.state = 'IN_SPEECH'
          this.port.postMessage({
            type: 'speech_start',
            trackType: this.trackType,
            rms,
            noiseFloor: this.noiseFloor,
            startThreshold: this.startThreshold,
            stopThreshold: this.stopThreshold,
            timestampMs
          })
        }
      } else {
        this.state = 'IDLE'
        this.activeFrames = 0
      }
      return
    }

    if (this.state === 'IN_SPEECH') {
      if (rms < this.stopThreshold) {
        this.state = 'POST_SPEECH'
        this.inactiveFrames = 1
      }
      return
    }

    if (this.state === 'POST_SPEECH') {
      if (rms > this.stopThreshold) {
        this.state = 'IN_SPEECH'
        this.inactiveFrames = 0
      } else {
        this.inactiveFrames += 1
        if (this.inactiveFrames >= STOP_FRAMES) {
          this.state = 'IDLE'
          this.port.postMessage({
            type: 'speech_end',
            trackType: this.trackType,
            rms,
            noiseFloor: this.noiseFloor,
            startThreshold: this.startThreshold,
            stopThreshold: this.stopThreshold,
            timestampMs
          })
        }
      }
    }
  }

  updateThresholds() {
    this.startThreshold = Math.max(this.noiseFloor * START_MULTIPLIER, MIN_START_THRESHOLD)
    this.stopThreshold = Math.max(this.noiseFloor * STOP_MULTIPLIER, MIN_STOP_THRESHOLD)
  }
}

registerProcessor('vad-processor', VADProcessor)
