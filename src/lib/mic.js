// Browser microphone capture -> 16 kHz mono Int16 PCM for Speechmatics.
// AudioWorklet is the primary path; ScriptProcessor remains as a compatibility
// fallback for older Safari versions.

export const TARGET_RATE = 16000
export const CHUNK_SAMPLES = 2048

export class StreamingResampler {
  constructor(inputRate, targetRate = TARGET_RATE) {
    this.step = inputRate / targetRate
    this.position = 0
    this.previous = 0
    this.hasPrevious = false
  }

  push(input) {
    if (!input.length) return new Float32Array(0)
    const output = new Float32Array(Math.ceil((input.length + 1) / this.step) + 1)
    let outputLength = 0
    let position = this.position

    while (position <= input.length - 1) {
      const index = Math.floor(position)
      const fraction = position - index
      const left = index < 0 ? (this.hasPrevious ? this.previous : input[0]) : input[index]
      const right = index + 1 < input.length ? input[index + 1] : input[input.length - 1]
      output[outputLength++] = left + (right - left) * fraction
      position += this.step
    }

    this.position = position - input.length
    this.previous = input[input.length - 1]
    this.hasPrevious = true
    return output.subarray(0, outputLength)
  }
}

export async function startMic(onAudio, onStatus, { deviceId } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone not available in this browser. Use HTTPS or localhost, and allow mic access.')
  }

  const audio = deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true
  const stream = await navigator.mediaDevices.getUserMedia({ audio })
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) {
    stream.getTracks().forEach((track) => track.stop())
    throw new Error('Web Audio is not available in this browser.')
  }

  const context = new Ctx({ latencyHint: 'interactive' })
  if (context.state === 'suspended') await context.resume()
  const source = context.createMediaStreamSource(stream)
  let capture

  try {
    capture = await createWorkletCapture(context, source, onAudio)
  } catch {
    capture = createLegacyCapture(context, source, onAudio)
  }

  onStatus?.('live')
  let stopped = false
  return {
    context,
    stream,
    stop() {
      if (stopped) return
      stopped = true
      capture.stop()
      stream.getTracks().forEach((track) => track.stop())
      context.close().catch(() => {})
      onStatus?.('stopped')
    },
  }
}

async function createWorkletCapture(context, source, onAudio) {
  if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('AudioWorklet unavailable')
  const moduleUrl = new URL('audio-worklet.js', document.baseURI).href
  await context.audioWorklet.addModule(moduleUrl)
  const node = new AudioWorkletNode(context, 'prompter-pcm', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  })
  node.port.onmessage = (event) => onAudio(new Int16Array(event.data))
  source.connect(node)
  node.connect(context.destination)
  return {
    stop() {
      node.port.onmessage = null
      try {
        node.disconnect()
        source.disconnect()
      } catch {}
    },
  }
}

function createLegacyCapture(context, source, onAudio) {
  const processor = context.createScriptProcessor(4096, 1, 1)
  const resampler = new StreamingResampler(context.sampleRate)
  let buffer = new Int16Array(CHUNK_SAMPLES)
  let length = 0

  processor.onaudioprocess = (event) => {
    const samples = resampler.push(event.inputBuffer.getChannelData(0))
    for (let i = 0; i < samples.length; i += 1) {
      const value = Math.max(-1, Math.min(1, samples[i]))
      buffer[length++] = Math.round(value < 0 ? value * 0x8000 : value * 0x7fff)
      if (length === CHUNK_SAMPLES) {
        onAudio(buffer)
        buffer = new Int16Array(CHUNK_SAMPLES)
        length = 0
      }
    }
  }

  source.connect(processor)
  processor.connect(context.destination)
  return {
    stop() {
      processor.onaudioprocess = null
      try {
        processor.disconnect()
        source.disconnect()
      } catch {}
    },
  }
}
