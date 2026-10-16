import { readCapped, safeGet } from '@/modules/social-hub/lib/safe-fetch'
import { SocialError, type LinkPreview } from '@/modules/social-hub/lib/types'

const MAX_HTML_BYTES = 600_000

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => safeCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/** Every <meta> tag as a lowercase key -> content map (first one wins). */
export function readMetaTags(html: string): Map<string, string> {
  const out = new Map<string, string>()
  const tags = html.match(/<meta\s[^>]*>/gi) ?? []
  for (const tag of tags) {
    const attrs = new Map<string, string>()
    for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attrs.set((m[1] ?? '').toLowerCase(), m[3] ?? m[4] ?? '')
    }
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase()
    const content = attrs.get('content')
    if (key && content && !out.has(key)) out.set(key, decodeEntities(content).trim())
  }
  return out
}

function clean(value: string | undefined, max: number): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : null
}

export function parsePreview(html: string, pageUrl: string): LinkPreview {
  const meta = readMetaTags(html)
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const title = clean(meta.get('og:title') ?? meta.get('twitter:title') ?? (titleTag ? decodeEntities(titleTag) : undefined), 200)
  const description = clean(meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'), 400)
  const rawImage = meta.get('og:image:secure_url') ?? meta.get('og:image') ?? meta.get('twitter:image')
  let imageUrl: string | null = null
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, pageUrl)
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') imageUrl = resolved.toString()
    } catch {
      imageUrl = null
    }
  }
  return {
    url: pageUrl,
    title,
    description,
    imageUrl,
    siteName: clean(meta.get('og:site_name'), 80),
  }
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  const { response, finalUrl } = await safeGet(rawUrl, { accept: 'text/html,application/xhtml+xml' })
  if (!response.ok) throw new SocialError('That page would not open, so there is no preview to show.')
  const type = response.headers.get('content-type') ?? ''
  if (!/html|xml/i.test(type)) {
    return { url: rawUrl, title: null, description: null, imageUrl: null, siteName: null }
  }
  const bytes = await readCappedLenient(response)
  const html = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const preview = parsePreview(html, finalUrl)
  // Keep the address the person typed: tracking-free and what they meant to share.
  return { ...preview, url: rawUrl }
}

// Only the head of a page carries the tags, so a page bigger than the cap is
// truncated rather than refused.
async function readCappedLenient(response: Response): Promise<Uint8Array> {
  try {
    return await readCapped(response, MAX_HTML_BYTES)
  } catch {
    return new Uint8Array()
  }
}
