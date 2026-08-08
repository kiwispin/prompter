const TARGET_RATE = 16000
const CHUNK_SAMPLES = 2048

class StreamingResampler {
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

class PrompterPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.resampler = new StreamingResampler(sampleRate)
    this.buffer = new Int16Array(CHUNK_SAMPLES)
    this.length = 0
  }

  process(inputs) {
    const channels = inputs[0]
    if (!channels?.length || !channels[0]?.length) return true

    const mono = new Float32Array(channels[0].length)
    for (const channel of channels) {
      for (let i = 0; i < mono.length; i += 1) mono[i] += channel[i] / channels.length
    }

    const samples = this.resampler.push(mono)
    for (let i = 0; i < samples.length; i += 1) {
      const value = Math.max(-1, Math.min(1, samples[i]))
      this.buffer[this.length++] = Math.round(value < 0 ? value * 0x8000 : value * 0x7fff)
      if (this.length === CHUNK_SAMPLES) {
        const complete = this.buffer
        this.buffer = new Int16Array(CHUNK_SAMPLES)
        this.length = 0
        this.port.postMessage(complete.buffer, [complete.buffer])
      }
    }
    return true
  }
}

registerProcessor('prompter-pcm', PrompterPcmProcessor)
