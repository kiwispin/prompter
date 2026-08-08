// Cloudflare Worker — Speechmatics token proxy.
//
// Holds the long-lived Speechmatics API key as a Worker secret
// (SPEECHMATICS_API_KEY) and mints short-lived realtime tokens for the app.
// The raw key never reaches any browser, so devices need no setup at all.
//
// Endpoint:  POST /token
// Returns:   { "key": "<jwt>" }
//
// Deploy:
//   1. npx wrangler login
//   2. npx wrangler deploy
//   3. npx wrangler secret put SPEECHMATICS_API_KEY
// Then set TOKEN_PROXY_URL in the app's src/config.js to the Worker URL.

function allowedOrigin(env, origin) {
  if (!origin) return true // non-browser clients (curl etc.)
  const list = (env.ALLOWED_ORIGINS || 'https://kiwispin.github.io,http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.includes(origin)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')
    const headers = {
      'Access-Control-Allow-Origin': allowedOrigin(env, origin) ? origin || '*' : '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (request.method === 'OPTIONS') {
      return new Response('', { headers })
    }

    if (url.pathname === '/token' && request.method === 'POST') {
      if (!allowedOrigin(env, origin)) {
        return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } })
      }
      if (!env.SPEECHMATICS_API_KEY) {
        return new Response(JSON.stringify({ error: 'server_not_configured' }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } })
      }

      const res = await fetch('https://mp.speechmatics.com/v1/api_keys?type=rt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.SPEECHMATICS_API_KEY}`,
        },
        body: JSON.stringify({ ttl: 60 }),
      })

      if (!res.ok) {
        return new Response(JSON.stringify({ error: 'speechmatics_failed', status: res.status }), { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } })
      }
      const data = await res.json()
      return new Response(JSON.stringify({ key: data.key_value }), { headers: { ...headers, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } })
  },
}
