import { describe, expect, it, vi } from 'vitest'
import { escapeLinkedInText } from '@/modules/social-hub/lib/linkedin-text'
import { decodeEntities, parsePreview, readMetaTags } from '@/modules/social-hub/lib/link-preview'
import { firstUrl, proxiedImage } from '@/modules/social-hub/lib/urls'
import { checkPost, PostInput, type PostInputData } from '@/modules/social-hub/lib/rules'
import { isPrivateAddress } from '@/modules/social-hub/lib/safe-fetch'
import { parseFacebookPost, facebookAuthUrl, graphError, missingFacebookPermissions } from '@/modules/social-hub/lib/facebook'
import { imageUrnsOf, linkedInAuthUrl, linkedInError, parseLinkedInPost, readLinkedInText } from '@/modules/social-hub/lib/linkedin'
import { callbackUrl, requestOrigin } from '@/modules/social-hub/lib/origin'
import { relativeTime, toLocalInput } from '@/modules/social-hub/components/admin/hub/format'
import type { Connection } from '@/modules/social-hub/lib/types'

vi.mock('@/lib/crypto/secrets', () => {
  const store = new Map<string, string>()
  return {
    encryptSecret: (v: string) => { const k = `enc${store.size}`; store.set(k, v); return k },
    decryptSecret: (v: string) => { const out = store.get(v); if (out === undefined) throw new Error('bad'); return out },
  }
})

const conn = (over: Partial<Connection> = {}): Connection => ({
  id: 'c1', provider: 'facebook', externalId: '1', name: 'Page', pictureUrl: null, profileUrl: null,
  status: 'active', lastError: null, lastSyncedAt: null, tokenExpiresAt: null, createdAt: '2026-01-01T00:00:00Z', ...over,
})

const base: PostInputData = { body: 'Hello', images: [], connectionIds: ['c1'], mode: 'now' }

describe('LinkedIn text escaping', () => {
  it('escapes the characters LinkedIn treats as markup', () => {
    expect(escapeLinkedInText('Sale (50% off) [today] <now> a_b *x* ~y~ {z} | @you')).toBe(
      'Sale \\(50% off\\) \\[today\\] \\<now\\> a\\_b \\*x\\* \\~y\\~ \\{z\\} \\| \\@you',
    )
  })
  it('keeps hashtags live and escapes a stray hash', () => {
    expect(escapeLinkedInText('Love #cactus and # alone')).toBe('Love #cactus and \\# alone')
  })
  it('escapes backslashes first so nothing is double-treated', () => {
    expect(escapeLinkedInText('a\\b')).toBe('a\\\\b')
  })
  it('reads LinkedIn text back into plain words', () => {
    expect(readLinkedInText('Hi @[Acme Ltd](urn:li:organization:5) \\(ok\\) {hashtag|\\#|cactus}')).toBe('Hi Acme Ltd (ok) #cactus')
  })
})

describe('link previews', () => {
  const html = `<html><head><title>Fallback &amp; title</title>
    <meta property="og:title" content="Big &quot;News&quot;">
    <meta property="og:description" content="A   long
    description">
    <meta property="og:image" content="/img/cover.png">
    <meta property="og:site_name" content="Acme"></head></html>`
  it('reads open graph tags and resolves relative pictures', () => {
    const p = parsePreview(html, 'https://example.com/post/1')
    expect(p.title).toBe('Big "News"')
    expect(p.description).toBe('A long description')
    expect(p.imageUrl).toBe('https://example.com/img/cover.png')
    expect(p.siteName).toBe('Acme')
  })
  it('falls back to the title tag', () => {
    expect(parsePreview('<title>Just a title</title>', 'https://a.test/').title).toBe('Just a title')
  })
  it('refuses non-http pictures', () => {
    expect(parsePreview('<meta property="og:image" content="javascript:alert(1)">', 'https://a.test/').imageUrl).toBeNull()
  })
  it('decodes entities and reads meta in either attribute order', () => {
    expect(decodeEntities('&lt;b&gt; &#65;&#x42;')).toBe('<b> AB')
    expect(readMetaTags('<meta content="x" name="description">').get('description')).toBe('x')
  })
  it('finds the first link and trims punctuation', () => {
    expect(firstUrl('see https://example.com/a?b=1, thanks')).toBe('https://example.com/a?b=1')
    expect(firstUrl('nothing here')).toBeNull()
  })
  it('proxies only remote pictures', () => {
    expect(proxiedImage('/media/a.png')).toBe('/media/a.png')
    expect(proxiedImage('https://x.test/a.png')).toBe('/api/m/social-hub/admin/image?u=https%3A%2F%2Fx.test%2Fa.png')
  })
})

describe('post rules', () => {
  const now = Date.parse('2026-10-16T12:00:00Z')
  it('lets a draft be half finished', () => {
    expect(checkPost({ ...base, body: '', connectionIds: [], mode: 'draft' }, [], now)).toBeNull()
  })
  it('needs something to post and somewhere to post it', () => {
    expect(checkPost({ ...base, body: '  ' }, [conn()], now)).toMatch(/Write something/)
    expect(checkPost({ ...base, connectionIds: [] }, [conn()], now)).toMatch(/at least one page/)
  })
  it('refuses pages that are gone or need reconnecting', () => {
    expect(checkPost(base, [], now)).toMatch(/not connected/)
    expect(checkPost(base, [conn({ status: 'needs_reauth' })], now)).toMatch(/needs reconnecting/)
  })
  it('wants a future time for a schedule', () => {
    const sched = { ...base, mode: 'schedule' as const }
    expect(checkPost(sched, [conn()], now)).toMatch(/date and time/)
    expect(checkPost({ ...sched, scheduledAt: '2026-10-16T12:00:30Z' }, [conn()], now)).toMatch(/at least a minute/)
    expect(checkPost({ ...sched, scheduledAt: '2026-10-17T09:00:00Z' }, [conn()], now)).toBeNull()
  })
  it('validates the shape', () => {
    expect(PostInput.safeParse({ ...base, body: 'x'.repeat(3001) }).success).toBe(false)
    expect(PostInput.safeParse({ ...base, images: Array.from({ length: 5 }, () => ({ url: '/a.png' })) }).success).toBe(false)
    expect(PostInput.safeParse({ ...base, images: [{ url: 'javascript:alert(1)' }] }).success).toBe(false)
    expect(PostInput.safeParse({ ...base, images: [{ url: '/media/a.png' }] }).success).toBe(true)
  })
})

describe('private addresses', () => {
  it.each(['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', '::ffff:10.0.0.1', 'not-an-ip'])('refuses %s', (a) => {
    expect(isPrivateAddress(a)).toBe(true)
  })
  it.each(['8.8.8.8', '151.101.1.69', '2606:4700::1111'])('allows %s', (a) => {
    expect(isPrivateAddress(a)).toBe(false)
  })
})

describe('facebook', () => {
  it('parses a link post with counts', () => {
    const p = parseFacebookPost({
      id: '1_2', message: 'Hi', created_time: '2026-10-01T10:00:00+0000', permalink_url: '/1/posts/2',
      full_picture: 'https://scontent/x.jpg',
      attachments: { data: [{ type: 'share', url: 'https://example.com', title: 'Ex' }] },
      likes: { summary: { total_count: 4 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 },
    })
    expect(p).toMatchObject({ externalId: '1_2', permalink: 'https://www.facebook.com/1/posts/2', linkUrl: 'https://example.com', likeCount: 4, commentCount: 2, shareCount: 1, imageUrls: ['https://scontent/x.jpg'] })
  })
  it('prefers album pictures and skips junk', () => {
    const p = parseFacebookPost({ id: '9', attachments: { data: [{ subattachments: { data: [{ media: { image: { src: 'a' } } }, { media: { image: { src: 'b' } } }] } }] } })
    expect(p?.imageUrls).toEqual(['a', 'b'])
    expect(parseFacebookPost({ nope: true })).toBeNull()
  })
  it('turns token errors into a reconnect message', () => {
    expect(graphError({ error: { code: 190, message: 'x' } }, 400).authFailure).toBe(true)
    expect(graphError({ error: { code: 100, message: 'bad param' } }, 400).message).toBe('bad param')
  })
  it('finds permissions the sign-in did not grant', () => {
    expect(missingFacebookPermissions({ data: [{ permission: 'pages_show_list', status: 'granted' }, { permission: 'pages_manage_posts', status: 'declined' }] }))
      .toEqual(['pages_read_engagement', 'pages_manage_posts'])
    expect(missingFacebookPermissions({ data: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'].map((permission) => ({ permission, status: 'granted' })) })).toEqual([])
  })
  it('builds a login address with scopes or a configuration', () => {
    const plain = facebookAuthUrl({ clientId: 'A', clientSecret: 's', configId: null }, 'https://s.test/cb', 'st')
    expect(plain).toContain('scope=pages_show_list%2Cpages_read_engagement%2Cpages_manage_posts')
    const biz = facebookAuthUrl({ clientId: 'A', clientSecret: 's', configId: 'C1' }, 'https://s.test/cb', 'st')
    expect(biz).toContain('config_id=C1')
    expect(biz).not.toContain('scope=')
  })
})

describe('linkedin', () => {
  it('parses a published post and ignores drafts', () => {
    const p = parseLinkedInPost({ id: 'urn:li:share:1', commentary: 'Hello \\(world\\)', publishedAt: 1760000000000, lifecycleState: 'PUBLISHED', content: { article: { source: 'https://x.test', title: 'T' } } })
    expect(p).toMatchObject({ message: 'Hello (world)', linkUrl: 'https://x.test', permalink: 'https://www.linkedin.com/feed/update/urn:li:share:1' })
    expect(parseLinkedInPost({ id: 'urn:li:share:2', lifecycleState: 'DRAFT' })).toBeNull()
  })
  it('collects image urns from every content shape', () => {
    expect(imageUrnsOf({ content: { multiImage: { images: [{ id: 'urn:li:image:a' }, { id: 'urn:li:image:b' }] } } })).toEqual(['urn:li:image:a', 'urn:li:image:b'])
    expect(imageUrnsOf({ content: { media: { id: 'urn:li:image:c' } } })).toEqual(['urn:li:image:c'])
    expect(imageUrnsOf({ content: { media: { id: 'urn:li:video:c' } } })).toEqual([])
  })
  it('flags authorisation failures', () => {
    expect(linkedInError({ message: 'x' }, 401).authFailure).toBe(true)
    expect(linkedInError({ message: 'nope' }, 403).authFailure).toBe(false)
  })
  it('builds the login address', () => {
    const url = linkedInAuthUrl({ clientId: 'C', clientSecret: 's', configId: null }, 'https://s.test/cb', 'st')
    expect(url).toContain('w_organization_social')
    expect(url).toContain('state=st')
  })
})

describe('oauth state', () => {
  it('hands back the redirect only for the cookie we issued, for the same person and network, before it expires', async () => {
    const { createState, readState } = await import('@/modules/social-hub/lib/oauth-state')
    const r = 'https://deskwell.co.uk/api/m/social-hub/oauth/facebook/callback'
    const { state, cookie } = createState('facebook', 'u1', r, 1_000)
    expect(readState(cookie, state, 'facebook', 'u1', 2_000)).toBe(r)
    expect(readState(cookie, state, 'linkedin', 'u1', 2_000)).toBeNull()
    expect(readState(cookie, state, 'facebook', 'u2', 2_000)).toBeNull()
    expect(readState(cookie, 'other', 'facebook', 'u1', 2_000)).toBeNull()
    expect(readState(cookie, state, 'facebook', 'u1', 1_000 + 601_000)).toBeNull()
    expect(readState(undefined, state, 'facebook', 'u1')).toBeNull()
  })
})

describe('request origin', () => {
  const h = (o: Record<string, string>) => new Headers(o)
  it('uses the address the browser used, not a stale SITE_URL', () => {
    expect(requestOrigin(h({ 'x-forwarded-host': 'deskwell.co.uk', 'x-forwarded-proto': 'https' }), 'https://x.test')).toBe('https://deskwell.co.uk')
    expect(requestOrigin(h({ host: 'www.deskwell.co.uk' }), 'https://x.test')).toBe('https://www.deskwell.co.uk')
    expect(requestOrigin(h({ host: 'localhost:3000' }), 'https://x.test')).toBe('http://localhost:3000')
  })
  it('falls back to the request address and refuses odd hosts', () => {
    expect(requestOrigin(h({ host: 'evil.test/../x' }), 'https://fallback.test/a')).toBe('https://fallback.test')
    expect(callbackUrl('linkedin', 'https://a.test')).toBe('https://a.test/api/m/social-hub/oauth/linkedin/callback')
  })
})

describe('formatting', () => {
  it('says how long ago', () => {
    const now = Date.parse('2026-10-16T12:00:00Z')
    expect(relativeTime('2026-10-16T11:59:50Z', now)).toBe('Just now')
    expect(relativeTime('2026-10-16T11:30:00Z', now)).toBe('30 min ago')
    expect(relativeTime('2026-10-15T08:00:00Z', now)).toBe('Yesterday')
    expect(relativeTime(null, now)).toBe('')
  })
  it('formats a datetime-local value', () => {
    expect(toLocalInput(new Date(2026, 9, 5, 9, 7))).toBe('2026-10-05T09:07')
  })
})
