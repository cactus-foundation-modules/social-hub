import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { SocialError } from '@/modules/social-hub/lib/types'

// The link preview and the picture proxy both fetch an address a person typed.
// Left unchecked that is a way to make the server read its own network, so every
// hop - including each redirect - is resolved and refused if it lands anywhere
// private, local or link-local.

const MAX_REDIRECTS = 4
const TIMEOUT_MS = 8_000

/** True for any address that is not routable on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address)
  if (kind === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number]
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (kind === 6) {
    const lower = address.toLowerCase()
    if (lower === '::' || lower === '::1') return true
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped?.[1]) return isPrivateAddress(mapped[1])
    return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') ||
      lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')
  }
  return true
}

/** Throws unless the address is an http(s) URL pointing at the public internet. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SocialError('That does not look like a web address.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SocialError('Only http and https addresses can be used.')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new SocialError('That address is not on the public internet.')
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new SocialError('That address is not on the public internet.')
    return url
  }
  let addresses: { address: string }[]
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new SocialError('That website could not be found.')
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new SocialError('That address is not on the public internet.')
  }
  return url
}

export type SafeResponse = { response: Response; finalUrl: string }

/** GET with the public-address check applied to every redirect hop. */
export async function safeGet(raw: string, headers: Record<string, string> = {}): Promise<SafeResponse> {
  let current = raw
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertPublicUrl(current)
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; CactusSocialHub/1.0)', ...headers },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch {
      throw new SocialError('That website did not answer.')
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location')
      if (!next) throw new SocialError('That website redirected somewhere unusable.')
      current = new URL(next, url).toString()
      continue
    }
    return { response, finalUrl: url.toString() }
  }
  throw new SocialError('That website redirected too many times.')
}

/** Read at most `maxBytes` of a response body, so a huge file cannot fill memory. */
export async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new SocialError('That file is too large.')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
