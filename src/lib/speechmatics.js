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

export function isTransientSessionLimitError(error) {
  const type = String(error?.type || '').toLowerCase()
  const reason = String(error?.reason || error?.message || '').toLowerCase()
  if (type === 'insufficient_funds' || /insufficient funds|credit|balance|free usage/.test(reason)) return false
  return (
    /concurr|simultaneous|active session|session limit|too many session/.test(`${type} ${reason}`) ||
    type === 'quota_exceeded' ||
    /quota/.test(reason)
  )
}

export function friendlySpeechmaticsError(error) {
  const type = String(error?.type || '').toLowerCase()
  const reason = String(error?.reason || error?.message || '')
  if (isTransientSessionLimitError(error)) {
    return 'Speech recognition is still releasing an earlier rehearsal session. Close any other Prompter tabs and try again in a few seconds.'
  }
  if (type === 'insufficient_funds' || /insufficient funds|credit|balance|free usage/i.test(reason)) {
    return 'The Speechmatics account has no transcription allowance remaining. Check its usage and billing settings.'
  }
  return reason || 'Speechmatics error'
}

export function isReusableRecognitionSession(session) {
  return Boolean(session?.mic && session?.client?.state === 'recording')
}

function speechmaticsError(data) {
  const error = new Error(data?.reason || data?.type || 'Speechmatics error')
  error.type = data?.type || ''
  error.reason = data?.reason || ''
  return error
}

// Get a short-lived realtime token. Prefers the token proxy (no key on the
// device); falls back to minting directly from the raw API key.
export async function getTempKey({ apiKey, tokenProxyUrl } = {}) {
  if (tokenProxyUrl) {
    try {
      const res = await fetch(`${tokenProxyUrl.replace(/\/+$/, '')}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        let detail = ''
        try {
          detail = (await res.json()).error || ''
        } catch {}
        const err = new Error(`Token proxy failed (${res.status})${detail ? `: ${detail}` : ''}`)
        err.status = res.status
        throw err
      }
      const data = await res.json()
      if (!data.key) throw new Error('Token proxy returned no token')
      return data.key
    } catch (error) {
      // A manually entered key is a real fallback when the optional proxy is
      // unavailable. Without one, preserve the useful proxy error.
      if (!apiKey) throw error
    }
  }
  return mintTempKey(apiKey)
}

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

export function wordsFrom(message) {
  const words = []
  const endTimes = []
  const confidences = []
  for (const result of message?.results || []) {
    if (result?.type !== 'word' || !result.alternatives?.length) continue
    words.push(result.alternatives[0].content || '')
    endTimes.push(result.end_time ?? null)
    confidences.push(result.alternatives[0].confidence ?? null)
  }
  return { words, endTimes, confidences }
}

export function buildStartRecognition({ language = 'en', operatingPoint = 'enhanced', additionalVocab = [] } = {}) {
  const transcriptionConfig = {
    language,
    operating_point: operatingPoint,
    max_delay: 1,
    enable_partials: true,
    conversation_config: { end_of_utterance_silence_trigger: 0.7 },
  }
  if (additionalVocab.length) transcriptionConfig.additional_vocab = additionalVocab
  return {
    message: 'StartRecognition',
    audio_format: AUDIO_FORMAT,
    transcription_config: transcriptionConfig,
  }
}

export class SpeechmaticsClient {
  constructor({
    apiKey,
    tokenProxyUrl,
    language = 'en',
    model = 'enhanced',
    additionalVocab = [],
    onPartial,
    onFinal,
    onPartialResult,
    onFinalResult,
    onEndOfUtterance,
    onClosed,
    onStatus,
    onError,
  }) {
    this.apiKey = apiKey
    this.tokenProxyUrl = tokenProxyUrl
    this.language = language
    this.model = model
    this.additionalVocab = additionalVocab
    this.onPartial = onPartial || (() => {})
    this.onFinal = onFinal || (() => {})
    this.onPartialResult = onPartialResult || (() => {})
    this.onFinalResult = onFinalResult || (() => {})
    this.onEndOfUtterance = onEndOfUtterance || (() => {})
    this.onClosed = onClosed || (() => {})
    this.onStatus = onStatus || (() => {})
    this.onError = onError || (() => {})
    this.ws = null
    this.started = false
    this.lastSeqNo = 0
    this.closedError = null
    this.intentionalClose = false
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
    this.closedError = null
    this.intentionalClose = false
    this.lastSeqNo = 0
    this.onStatus('authenticating')

    let jwt
    try {
      jwt = await getTempKey({ apiKey: this.apiKey, tokenProxyUrl: this.tokenProxyUrl })
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
    this.sendJson(buildStartRecognition({
      language: this.language,
      operatingPoint: this.model,
      additionalVocab: this.additionalVocab,
    }))
  }

  waitForStart() {
    return new Promise((resolve, reject) => {
      let finished = false
      const timeout = setTimeout(() => {
        if (finished) return
        finished = true
        reject(new Error('Timed out waiting for recognition to start'))
      }, 15000)
      const check = () => {
        if (finished) return
        if (this.started) {
          finished = true
          clearTimeout(timeout)
          resolve()
          return
        }
        if (this.closedError) {
          finished = true
          clearTimeout(timeout)
          reject(this.closedError)
          return
        }
        setTimeout(check, 100)
      }
      check()
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
        this.onPartialResult(wordsFrom(data))
        if (data.metadata && data.metadata.transcript) {
          this.onPartial(data.metadata.transcript)
        }
        break
      case 'AddTranscript':
        this.onFinalResult(wordsFrom(data))
        if (data.metadata && data.metadata.transcript) {
          this.onFinal(data.metadata.transcript)
        }
        break
      case 'EndOfUtterance':
        this.onEndOfUtterance()
        break
      case 'Error':
        this.closedError = speechmaticsError(data)
        this.onError(this.closedError)
        break
      default:
        break
    }
  }

  handleClose(ev) {
    const intentional = this.intentionalClose
    if (!intentional && !this.closedError && ev.code && ev.code !== 1000) {
      this.closedError = new Error(`Connection closed (${ev.code})`)
      this.onError(this.closedError)
    }
    this.started = false
    this.onStatus('closed')
    if (!intentional) this.onClosed(ev)
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
    const ws = this.ws
    this.intentionalClose = true
    this.ws = null
    try {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close(1000, 'Prompter session ended')
      }
    } catch {}
    this.started = false
    this.onStatus('closed')
  }
}
