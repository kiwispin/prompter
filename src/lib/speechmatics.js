// Minimal, dependency-free Speechmatics realtime WebSocket client.
// Protocol based on https://docs.speechmatics.com/api-ref/realtime-transcription-websocket.md
//
// Flow:
//   1. POST to the temp-key endpoint with the long-lived API key
//   2. open wss://<host>/v2?jwt=<tempKey>
//   3. send StartRecognition + raw pcm16 audio chunks
//   4. emit partial/final transcripts + errors

export const RT_WS_HOST = 'global.rt.speechmatics.com'
export const TEMP_KEY_URL = 'https://mp.speechmatics.com/v1/api_keys?type=rt'

// Mint a short-lived realtime token from the long-lived API key.
export async function mintTempKey(apiKey, { ttl = 60, host = TEMP_KEY_URL } = {}) {
  const res = await fetch(host, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ttl }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body.error || body.detail || JSON.stringify(body)
    } catch {
      detail = await res.text()
    }
    const err = new Error(`Speechmatics auth failed (${res.status})`)
    err.status = res.status
    err.detail = detail
    throw err
  }
  const data = await res.json()
  const jwt = data.key_value
  if (!jwt) throw new Error('Speechmatics auth returned no token')
  return jwt
}

const AUDIO_FORMAT = { type: 'raw', encoding: 'pcm_s16le', sample_rate: 16000 }

export class SpeechmaticsClient {
  constructor({
    apiKey,
    language = 'en',
    model = 'enhanced',
    onPartial,
    onFinal,
    onStatus,
    onError,
  }) {
    this.apiKey = apiKey
    this.language = language
    this.model = model
    this.onPartial = onPartial || (() => {})
    this.onFinal = onFinal || (() => {})
    this.onStatus = onStatus || (() => {})
    this.onError = onError || (() => {})
    this.ws = null
    this.started = false
    this.lastSeqNo = 0
  }

  get state() {
    if (!this.ws) return 'idle'
    const st = this.ws.readyState
    if (st === WebSocket.OPEN) return this.started ? 'recording' : 'connected'
    if (st === WebSocket.CONNECTING) return 'connecting'
    return 'closed'
  }

  async start() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    this.onStatus('authenticating')

    let jwt
    try {
      jwt = await mintTempKey(this.apiKey)
    } catch (err) {
      this.onError(err)
      throw err
    }

    await new Promise((resolve, reject) => {
      const url = `wss://${RT_WS_HOST}/v2?jwt=${encodeURIComponent(jwt)}`
      const ws = new WebSocket(url)
      this.ws = ws
      this.onStatus('connecting')

      const timeout = setTimeout(() => {
        try {
          ws.close()
        } catch {}
        reject(new Error('Timed out connecting to Speechmatics'))
      }, 15000)

      ws.addEventListener('open', () => {
        clearTimeout(timeout)
        this.sendStart()
        this.onStatus('starting')
        resolve()
      })
      ws.addEventListener('error', () => {
        clearTimeout(timeout)
        reject(new Error('WebSocket connection error'))
      })
      ws.addEventListener('close', (ev) => this.handleClose(ev))
      ws.addEventListener('message', (msg) => this.handleMessage(msg))
    }).catch((err) => {
      this.onError(err)
      throw err
    })

    // Wait for RecognitionStarted, which may arrive after open.
    if (!this.started) {
      await this.waitForStart()
    }
  }

  sendStart() {
    this.sendJson({
      message: 'StartRecognition',
      audio_format: AUDIO_FORMAT,
      transcription_config: {
        language: this.language,
        model: this.model,
        max_delay: 0.7,
        enable_partials: true,
      },
    })
  }

  waitForStart() {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.started) return resolve()
        if (this.closedError) return reject(this.closedError)
        setTimeout(check, 100)
      }
      check()
      setTimeout(() => reject(new Error('Timed out waiting for recognition to start')), 15000)
    })
  }

  handleMessage(event) {
    let data
    try {
      data = JSON.parse(event.data)
    } catch {
      return
    }
    if (!data || typeof data.message !== 'string') return

    switch (data.message) {
      case 'RecognitionStarted':
        this.started = true
        this.onStatus('recording')
        break
      case 'AudioAdded':
        this.lastSeqNo = data.seq_no
        break
      case 'AddPartialTranscript':
        if (data.metadata && data.metadata.transcript) {
          this.onPartial(data.metadata.transcript)
        }
        break
      case 'AddTranscript':
        if (data.metadata && data.metadata.transcript) {
          this.onFinal(data.metadata.transcript)
        }
        break
      case 'Error':
        this.onError(new Error(data.type ? `${data.type}: ${data.reason}` : 'Speechmatics error'))
        this.closedError = new Error(data.reason || data.type)
        break
      default:
        break
    }
  }

  handleClose(ev) {
    if (!this.closedError && ev.code && ev.code !== 1000) {
      this.closedError = new Error(`Connection closed (${ev.code})`)
    }
    this.started = false
    this.onStatus('closed')
  }

  sendJson(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(obj))
  }

  // Send raw pcm_s16le audio bytes.
  sendAudio(buffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.started) return
    this.ws.send(buffer)
  }

  stop() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.sendJson({ message: 'EndOfStream', last_seq_no: this.lastSeqNo })
      } catch {}
      this.onStatus('stopping')
    }
  }

  close() {
    try {
      this.ws && this.ws.close()
    } catch {}
    this.ws = null
    this.started = false
    this.onStatus('closed')
  }
}
