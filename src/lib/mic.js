// Microphone capture -> 16 kHz mono Int16 PCM, ready for Speechmatics.
//
// Uses ScriptProcessorNode (deprecated but universally supported, incl.
// iPad Safari) with manual downsampling from the device sample rate to 16k.
// Falls back gracefully if getUserMedia is unavailable.

export const TARGET_RATE = 16000

export async function startMic(onAudio, onStatus) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Microphone not available in this browser. Use HTTPS or localhost, and allow mic access.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  })

  const Ctx = window.AudioContext || window.webkitAudioContext
  const ctx = new Ctx({ latencyHint: 'interactive' })
  const source = ctx.createMediaStreamSource(stream)

  const rate = ctx.sampleRate
  const step = rate / TARGET_RATE

  let processor
  try {
    processor = ctx.createScriptProcessor(4096, 1, 1)
  } catch {
    // Fallback for browsers that cap buffer sizes.
    processor = ctx.createScriptProcessor(8192, 1, 1)
  }

  let pcmBuffer = new Int16Array(8192)
  let pcmLen = 0

  const flush = () => {
    if (pcmLen > 0) {
      onAudio(pcmBuffer.subarray(0, pcmLen))
      pcmLen = 0
    }
  }

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)
    const out = new Int16Array(Math.ceil(input.length / step))
    let oi = 0
    for (let i = 0; i < input.length; i += step) {
      let v = input[Math.min(input.length - 1, Math.floor(i))]
      v = Math.max(-1, Math.min(1, v))
      out[oi++] = v < 0 ? v * 0x8000 : v * 0x7fff
    }
    if (pcmLen + out.length > pcmBuffer.length) {
      const bigger = new Int16Array(Math.max(pcmBuffer.length * 2, pcmLen + out.length))
      bigger.set(pcmBuffer.subarray(0, pcmLen))
      pcmBuffer = bigger
    }
    pcmBuffer.set(out, pcmLen)
    pcmLen += out.length
    flush()
  }

  source.connect(processor)
  processor.connect(ctx.destination)

  onStatus && onStatus('live')

  let stopped = false
  return {
    context: ctx,
    stop() {
      if (stopped) return
      stopped = true
      try {
        processor.disconnect()
        source.disconnect()
      } catch {}
      stream.getTracks().forEach((t) => t.stop())
      try {
        ctx.close()
      } catch {}
      onStatus && onStatus('stopped')
    },
  }
}
