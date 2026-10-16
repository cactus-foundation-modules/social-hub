// Pure helpers for "has this web address been posted?". No server-only imports: the
// matching rules are unit-tested on their own and the shapes are shared with the screen.

import type { Provider } from '@/modules/social-hub/lib/types'

/** One page's answer for one address. */
export type LinkHit = {
  connectionId: string
  /** published: it is on the page. scheduled: waiting to go. failed: the last try did not go out. */
  state: 'published' | 'scheduled' | 'failed'
  /** Where to read it, once it is out. */
  permalink: string | null
  /** When it went out (published), is due (scheduled) or last tried (failed). */
  at: string | null
  error: string | null
}

export type LinkMatches = Record<string, Record<Provider, LinkHit[]>>

/**
 * A comparable form of a web address: no scheme, no "www.", no query or fragment,
 * no trailing slash, lower-cased. Tracking tags and "http" versus "https" are noise
 * when asking whether the same page was shared. Null when it is not a web address.
 */
export function normaliseLink(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const path = url.pathname.replace(/\/+$/, '')
  return `${host}${path}`.toLowerCase()
}

/** Every web address written in a piece of text, trailing punctuation removed. */
export function linksIn(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    out.push(match[0].replace(/[.,;:!?)\]}]+$/, ''))
  }
  return out
}

/** The normalised addresses a post refers to, whether as its link card or written in its text. */
export function postLinkKeys(linkUrl: string | null, text: string): Set<string> {
  const keys = new Set<string>()
  for (const candidate of [...(linkUrl ? [linkUrl] : []), ...linksIn(text)]) {
    const key = normaliseLink(candidate)
    if (key) keys.add(key)
  }
  return keys
}

const RANK: Record<LinkHit['state'], number> = { published: 0, scheduled: 1, failed: 2 }

/**
 * One answer per page. A page that has the post live beats one where it is only
 * scheduled, which beats a failed attempt - so a retry that worked, or a post that
 * was later put out by hand, does not leave a stale "failed" next to it.
 */
export function bestPerConnection(hits: LinkHit[]): LinkHit[] {
  const best = new Map<string, LinkHit>()
  for (const hit of hits) {
    const have = best.get(hit.connectionId)
    if (!have || RANK[hit.state] < RANK[have.state]) {
      best.set(hit.connectionId, hit)
      continue
    }
    if (RANK[hit.state] === RANK[have.state] && hit.state === 'published' && (hit.at ?? '') > (have.at ?? '')) {
      best.set(hit.connectionId, hit)
    }
  }
  return [...best.values()]
}
