// Loads a script from a web link. Google Docs shared as "Anyone with the link"
// can be read directly: Google's export endpoint allows cross-site reads, and
// the Markdown export keeps heading styles, which become segments here.

const GDOC_RE = /docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/
const GDOC_PUBLISHED_RE = /docs\.google\.com\/document\/d\/e\//

export function parseScriptLink(input) {
  const raw = String(input || '').trim()
  if (!raw) return { error: 'Paste a link first.' }
  if (GDOC_PUBLISHED_RE.test(raw)) {
    return { error: 'That’s a “Publish to web” link. In the doc, use Share → Copy link instead.' }
  }
  const doc = raw.match(GDOC_RE)
  if (doc) {
    return {
      kind: 'gdoc',
      id: doc[1],
      url: `https://docs.google.com/document/d/${doc[1]}/edit`,
      fetchUrl: `https://docs.google.com/document/d/${doc[1]}/export?format=md`,
    }
  }
  let url
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return { error: 'That doesn’t look like a link.' }
  }
  if (!/\./.test(url.hostname)) return { error: 'That doesn’t look like a link.' }
  return { kind: 'web', url: url.href, fetchUrl: url.href }
}

// Turns Google Docs Markdown into plain script text: keeps # headings and
// [cues], drops formatting marks, links, images and table rules.
export function markdownToScript(md) {
  const out = []
  for (let line of String(md || '').replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    if (/^\s*\[[^\]]+\]:\s*<?data:/i.test(line)) continue // embedded image data
    if (/^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line)) continue // table rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('')
      continue
    }

    line = line
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\s*\{#[\w-]+\}\s*$/, '') // heading anchors
      .replace(/!\[[^\]]*\](\([^)]*\)|\[[^\]]*\])/g, '') // images
      .replace(/(?<!\\)\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep their text
      .replace(/(?<!\\)(\*+|~~)/g, '') // bold, italic, strikethrough

    if (/^\s*\|.*\|\s*$/.test(line)) {
      line = line
        .trim()
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join('  ')
    }

    line = line
      .replace(/^\s*>\s?/, '') // quotes
      .replace(/^\s*(?:[-+]|\d+[.)])\s+/, '') // list markers
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~<])/g, '$1')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, '\'')
      .replace(/&amp;/g, '&')
      .replace(/[ \t ]+$/, '')
      .replace(/^[ \t ]+/, '')

    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function titleFromDisposition(header) {
  const h = String(header || '')
  const star = h.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i)
  let name = ''
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim())
    } catch {
      name = star[1].trim()
    }
  } else {
    const plain = h.match(/filename\s*=\s*"?([^";]+)"?/i)
    if (plain) name = plain[1].trim()
  }
  return name.replace(/\.(md|txt|markdown)$/i, '').trim()
}

export async function fetchScriptFromLink(input) {
  const link = parseScriptLink(input)
  if (link.error) throw new Error(link.error)

  const notShared =
    link.kind === 'gdoc'
      ? 'Couldn’t open that doc. In Google Docs, set Share → General access to “Anyone with the link”.'
      : 'Couldn’t load that link. The site may not allow other pages to read it. Google Docs links work best.'

  let res
  try {
    res = await fetch(link.fetchUrl, { cache: 'no-store' })
  } catch {
    throw new Error(navigator.onLine === false ? 'You’re offline. Connect to the internet and try again.' : notShared)
  }
  if (!res.ok) {
    throw new Error(res.status === 404 || res.status === 410 ? 'That doc wasn’t found. Check the link.' : notShared)
  }
  const type = res.headers.get('content-type') || ''
  if (/html/i.test(type)) throw new Error(notShared)

  const body = await res.text()
  const text = link.kind === 'gdoc' || /markdown/i.test(type) ? markdownToScript(body) : body.trim()
  if (!text) throw new Error('That doc is empty.')

  return {
    text,
    title: titleFromDisposition(res.headers.get('content-disposition')),
    source: { kind: link.kind, url: link.url },
  }
}
