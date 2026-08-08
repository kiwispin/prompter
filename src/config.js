// App configuration.
//
// TOKEN_PROXY_URL: your Cloudflare Worker that mints Speechmatics tokens.
// This URL is not a secret (it's just the gateway), so it can live in the
// bundle and every device works with zero setup. Leave empty to fall back to
// entering the raw API key directly in Settings.
//
// Set this to e.g. "https://prompter-token.<you>.workers.dev" after you
// deploy worker/worker.js.
export const TOKEN_PROXY_URL = 'https://prompter-token.kiwispin.workers.dev'
