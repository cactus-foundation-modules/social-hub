import { describe, expect, it } from 'vitest'
import { bestPerConnection, linksIn, normaliseLink, postLinkKeys, type LinkHit } from '@/modules/social-hub/lib/link-match'

const hit = (over: Partial<LinkHit>): LinkHit => ({
  connectionId: 'c1', state: 'published', permalink: null, at: null, error: null, ...over,
})

describe('normaliseLink', () => {
  it('treats scheme, www, case, trailing slash, query and fragment as noise', () => {
    const want = 'deskwell.co.uk/gazette/my-post'
    expect(normaliseLink('https://deskwell.co.uk/gazette/my-post')).toBe(want)
    expect(normaliseLink('http://www.Deskwell.co.uk/gazette/My-Post/')).toBe(want)
    expect(normaliseLink('https://deskwell.co.uk/gazette/my-post?utm_source=facebook#top')).toBe(want)
  })
  it('keeps different posts different', () => {
    expect(normaliseLink('https://a.com/one')).not.toBe(normaliseLink('https://a.com/one-more'))
  })
  it('refuses anything that is not a web address', () => {
    expect(normaliseLink('not a url')).toBeNull()
    expect(normaliseLink('mailto:a@b.com')).toBeNull()
  })
})

describe('postLinkKeys', () => {
  it('finds the link card and any address written in the text', () => {
    const keys = postLinkKeys('https://a.com/card/', 'Read https://www.a.com/written, then (https://b.com/x).')
    expect([...keys].sort()).toEqual(['a.com/card', 'a.com/written', 'b.com/x'])
  })
  it('copes with no link card', () => {
    expect([...postLinkKeys(null, 'no links here')]).toEqual([])
  })
})

describe('linksIn', () => {
  it('drops trailing punctuation', () => {
    expect(linksIn('See https://a.com/p. And https://b.com/q!')).toEqual(['https://a.com/p', 'https://b.com/q'])
  })
})

describe('bestPerConnection', () => {
  it('prefers live over scheduled over failed, per page', () => {
    const out = bestPerConnection([
      hit({ state: 'failed' }),
      hit({ state: 'scheduled' }),
      hit({ state: 'published', permalink: 'p' }),
      hit({ connectionId: 'c2', state: 'failed' }),
    ])
    expect(out.find((h) => h.connectionId === 'c1')?.state).toBe('published')
    expect(out.find((h) => h.connectionId === 'c2')?.state).toBe('failed')
  })
  it('keeps the newest of several live posts on one page', () => {
    const out = bestPerConnection([
      hit({ at: '2026-01-01T00:00:00Z', permalink: 'old' }),
      hit({ at: '2026-03-01T00:00:00Z', permalink: 'new' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.permalink).toBe('new')
  })
})
