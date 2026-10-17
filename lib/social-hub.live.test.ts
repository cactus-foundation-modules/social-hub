import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import type { ExtendedPrismaClient } from '@/lib/db/prisma'
import {
  vpsConfigFromEnv, createTestRole, createTestDatabase, dropTestDatabase, dropTestRole, dropStaleTestObjects,
  type VpsConfig, type TestRole, type TestDatabase,
} from '@/lib/backup/vps-database'

// ---------------------------------------------------------------------------
// Social Hub's SQL, executed.
//
// Every query in this module is raw SQL, and nothing else in the repository runs
// it: tsc and eslint see a template string, a build never executes a query, and
// the module build gate compiles rather than connects. A statement Postgres will
// not parse is green everywhere until somebody opens the screen.
//
// A real throwaway database on the Postgres VPS, built from the core schema and
// this module's migrations, named `cactus_rt_*` and dropped afterwards. The live
// site's database sits on the same server and is never named, opened or altered.
// The two networks are stood in for by a stubbed fetch, so the publish path runs
// end to end without anything leaving the machine.
//
//   RUN_SOCIAL_HUB_LIVE=1 npx vitest run \
//     modules/social-hub/lib/social-hub.live.test.ts --testTimeout 120000
//
// A SKIP here is a FAIL - the whole point is that the SQL runs.
// ---------------------------------------------------------------------------

const shouldRun = process.env.RUN_SOCIAL_HUB_LIVE === '1'
const CORE_SCHEMA = path.join(process.cwd(), 'prisma/migrations/20260626000000_init/migration.sql')
const MIGRATIONS = path.join(process.cwd(), 'modules/social-hub/migrations')
const KEY = 'b'.repeat(64)

type Extension = (typeof import('@/lib/db/prisma'))['stalePlanRetryExtension']

async function connect(uri: string, extension: Extension): Promise<ExtendedPrismaClient> {
  const db = new PrismaClient({ datasourceUrl: uri }).$extends(extension)
  for (let attempt = 0; ; attempt++) {
    try {
      await db.$queryRawUnsafe('SELECT 1')
      return db
    } catch (err) {
      if (attempt >= 15) throw err
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

describe.runIf(shouldRun)('Social Hub against a real database', () => {
  let vps: VpsConfig
  let role: TestRole
  let database: TestDatabase
  let db: ExtendedPrismaClient
  let conns: typeof import('./connections')
  let posts: typeof import('./posts')
  let settings: typeof import('./settings')
  let sync: typeof import('./sync')
  let publish: typeof import('./publish')
  let remote: typeof import('./remote-delete')
  let posted: typeof import('./posted-links')
  let follow: typeof import('./gazette-follow')
  let applyFile: (file: string) => Promise<void>
  let fbId = ''
  let liId = ''

  beforeAll(async () => {
    if (!process.env.OVH_SERVER || !process.env.OVH_USER || !process.env.OVH_PASSWORD) {
      throw new Error('OVH_SERVER, OVH_USER and OVH_PASSWORD are needed for this suite. Export them from the Deskwell workspace .env - a skip here is a fail.')
    }
    vps = vpsConfigFromEnv()
    await dropStaleTestObjects(vps)
    const stamp = Date.now()
    role = await createTestRole(vps, `cactus_rt_role_${stamp}`)
    database = await createTestDatabase(vps, `cactus_rt_shub_${stamp}`, role)
    process.env.DATABASE_URL = database.connectionUri
    process.env.ENCRYPTION_KEY = KEY
    process.env.SITE_URL = 'https://site.test'

    const { stalePlanRetryExtension } = await import('@/lib/db/prisma')
    const { splitSqlStatements } = await import('@/lib/backup/restore')
    db = await connect(database.connectionUri, stalePlanRetryExtension)
    applyFile = async (file) => {
      for (const statement of splitSqlStatements(readFileSync(file, 'utf8'))) await db.$executeRawUnsafe(statement)
    }
    await applyFile(CORE_SCHEMA)
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) await applyFile(path.join(MIGRATIONS, file))

    conns = await import('./connections')
    posts = await import('./posts')
    settings = await import('./settings')
    sync = await import('./sync')
    publish = await import('./publish')
    remote = await import('./remote-delete')
    posted = await import('./posted-links')
    follow = await import('./gazette-follow')

    await conns.upsertConnection({
      provider: 'facebook', externalId: 'fbpage1', name: 'Deskwell Facebook', pictureUrl: null, profileUrl: 'https://facebook.com/x',
      accessToken: 'fb-page-token', refreshToken: null, tokenExpiresAt: null, refreshExpiresAt: null, connectedBy: 'u1',
    })
    await conns.upsertConnection({
      provider: 'linkedin', externalId: '777', name: 'Deskwell LinkedIn', pictureUrl: null, profileUrl: null,
      accessToken: 'li-token', refreshToken: null, tokenExpiresAt: new Date(Date.now() + 40 * 86_400_000), refreshExpiresAt: null, connectedBy: 'u1',
    })
    const all = await conns.listConnections()
    fbId = all.find((c) => c.provider === 'facebook')!.id
    liId = all.find((c) => c.provider === 'linkedin')!.id
  }, 600_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await db?.$disconnect().catch(() => {})
    if (!vps) return
    if (database) await dropTestDatabase(vps, database.name).catch(() => {})
    if (role) await dropTestRole(vps, role.name).catch(() => {})
    await dropStaleTestObjects(vps).catch(() => {})
  }, 600_000)

  it('applies the migration a second time without complaint', async () => {
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) await applyFile(path.join(MIGRATIONS, file))
  })

  it('keeps app secrets encrypted and hands them back decrypted', async () => {
    await settings.updateSettings({ fbAppId: ' 123 ', fbAppSecret: 'shh', liClientId: 'abc', liClientSecret: 'li-shh', fbConfigId: '' })
    const view = await settings.getSettings()
    expect(view).toMatchObject({ fbAppId: '123', hasFbAppSecret: true, fbConfigId: '', liClientId: 'abc', hasLiClientSecret: true })
    const raw = await db.$queryRawUnsafe<{ fb_app_secret_enc: string }[]>('SELECT "fb_app_secret_enc" FROM "shub_settings"')
    expect(raw[0]!.fb_app_secret_enc).not.toContain('shh')
    expect(await settings.getAppCredentials('facebook')).toEqual({ clientId: '123', clientSecret: 'shh', configId: null })
    // A blank secret leaves the saved one alone.
    await settings.updateSettings({ fbAppSecret: '' })
    expect((await settings.getAppCredentials('facebook'))?.clientSecret).toBe('shh')
  })

  it('stores tokens encrypted, and reconnecting clears the "needs reconnecting" flag', async () => {
    await conns.markNeedsReauth(fbId, 'token gone')
    expect((await conns.listConnections()).find((c) => c.id === fbId)?.status).toBe('needs_reauth')
    await conns.upsertConnection({
      provider: 'facebook', externalId: 'fbpage1', name: 'Deskwell Facebook (renamed)', pictureUrl: null, profileUrl: null,
      accessToken: 'fb-page-token-2', refreshToken: null, tokenExpiresAt: null, refreshExpiresAt: null, connectedBy: 'u1',
    })
    const c = await conns.getConnectionWithSecrets(fbId)
    expect(c).toMatchObject({ status: 'active', name: 'Deskwell Facebook (renamed)', accessToken: 'fb-page-token-2', lastError: null })
    const raw = await db.$queryRawUnsafe<{ access_token_enc: string }[]>(`SELECT "access_token_enc" FROM "shub_connections" WHERE "id" = '${fbId}'`)
    expect(raw[0]!.access_token_enc).not.toContain('fb-page-token')
  })

  it('writes, reads, edits and counts posts', async () => {
    const id = await posts.createPost({
      body: 'Hello', linkUrl: 'https://example.com', linkTitle: 'Ex', images: [{ url: '/m/a.png', alt: 'A' }],
      connectionIds: [fbId, liId], mode: 'schedule', scheduledAt: '2030-01-01T09:00:00Z',
    }, 'u1')
    const p = await posts.getPost(id)
    expect(p).toMatchObject({ body: 'Hello', status: 'scheduled', linkUrl: 'https://example.com', images: [{ url: '/m/a.png', alt: 'A' }] })
    expect(p?.scheduledAt).toBe('2030-01-01T09:00:00.000Z')
    expect(p?.targets.map((t) => t.provider).sort()).toEqual(['facebook', 'linkedin'])

    await posts.updatePost(id, { body: 'Edited', images: [], connectionIds: [fbId], mode: 'draft' })
    const edited = await posts.getPost(id)
    expect(edited).toMatchObject({ body: 'Edited', status: 'draft', scheduledAt: null, images: [] })
    expect(edited?.targets).toHaveLength(1)

    expect((await posts.listPosts(['draft'])).map((x) => x.id)).toContain(id)
    expect((await posts.countPosts()).draft).toBeGreaterThanOrEqual(1)
    expect(await posts.deletePost(id)).toBe(true)
    expect(await posts.getPost(id)).toBeNull()
  })

  it('hands a due post to exactly one runner, and not a future one', async () => {
    const due = await posts.createPost({ body: 'due', images: [], connectionIds: [fbId], mode: 'schedule', scheduledAt: '2030-01-01T00:00:00Z' }, 'u1')
    await db.$executeRawUnsafe(`UPDATE "shub_posts" SET "scheduled_at" = now() - interval '1 minute' WHERE "id" = '${due}'`)
    const future = await posts.createPost({ body: 'later', images: [], connectionIds: [fbId], mode: 'schedule', scheduledAt: '2030-01-01T00:00:00Z' }, 'u1')
    const [a, b] = await Promise.all([posts.claimNextDue(), posts.claimNextDue()])
    expect([a, b].filter(Boolean)).toEqual([due])
    expect((await posts.getPost(due))?.status).toBe('publishing')
    expect((await posts.getPost(future))?.status).toBe('scheduled')
    expect(await posts.claimPost(due)).toBe(false)
    await posts.deletePost(future)
  })

  it('settles a post as published, partly posted or failed from its pages', async () => {
    const id = await posts.createPost({ body: 'x', images: [], connectionIds: [fbId, liId], mode: 'draft' }, 'u1')
    const targets = (await posts.getPost(id))!.targets
    await posts.finishTarget(targets[0]!.id, { ok: true, externalId: 'e1', permalink: 'https://p' })
    await posts.finishTarget(targets[1]!.id, { ok: false, error: 'nope' })
    expect(await posts.settlePost(id)).toBe('partial')
    await posts.finishTarget(targets[1]!.id, { ok: true, externalId: 'e2', permalink: null })
    expect(await posts.settlePost(id)).toBe('published')
    expect((await posts.getPost(id))?.publishedAt).not.toBeNull()

    const bad = await posts.createPost({ body: 'y', images: [], connectionIds: [fbId], mode: 'draft' }, 'u1')
    await posts.finishTarget((await posts.getPost(bad))!.targets[0]!.id, { ok: false, error: 'nope' })
    expect(await posts.settlePost(bad)).toBe('failed')
  })

  it('fails the pages of a post whose runner died, so a person can look', async () => {
    const id = await posts.createPost({ body: 'stuck', images: [], connectionIds: [fbId], mode: 'draft' }, 'u1')
    await posts.claimPost(id)
    const t = (await posts.getPost(id))!.targets[0]!
    await posts.startTarget(t.id)
    await db.$executeRawUnsafe(`UPDATE "shub_posts" SET "updated_at" = now() - interval '30 minutes' WHERE "id" = '${id}'`)
    expect(await posts.releaseStalePosts()).toBeGreaterThanOrEqual(1)
    const after = await posts.getPost(id)
    expect(after?.status).toBe('failed')
    expect(after?.targets[0]?.error).toMatch(/interrupted/i)
  })

  it('caches what is on a page, forgets what was deleted, and says which posts came from here', async () => {
    const mk = (id: string, at: string) => ({
      externalId: id, message: `m ${id}`, permalink: `https://p/${id}`, imageUrls: ['https://i/1.jpg'], linkUrl: null, linkTitle: null,
      postedAt: new Date(at), likeCount: 3, commentCount: null, shareCount: 1,
    })
    await sync.storeRemotePosts(fbId, [mk('a', '2026-10-01T10:00:00Z'), mk('b', '2026-10-02T10:00:00Z')], 25)
    let feed = await sync.listFeed(null)
    expect(feed.filter((p) => p.connectionId === fbId).map((p) => p.externalId)).toEqual(['b', 'a'])
    expect(feed[0]).toMatchObject({ likeCount: 3, commentCount: null, imageUrls: ['https://i/1.jpg'], viaSocialHub: false })

    // 'a' disappears from the page; 'b' was published from here.
    const id = await posts.createPost({ body: 'b', images: [], connectionIds: [fbId], mode: 'draft' }, 'u1')
    await posts.finishTarget((await posts.getPost(id))!.targets[0]!.id, { ok: true, externalId: 'b', permalink: null })
    await sync.storeRemotePosts(fbId, [mk('b', '2026-10-02T10:00:00Z')], 25)
    feed = await sync.listFeed(fbId)
    expect(feed.map((p) => p.externalId)).toEqual(['b'])
    expect(feed[0]?.viaSocialHub).toBe(true)

    // A full page only forgets posts newer than the oldest one it holds.
    await sync.storeRemotePosts(fbId, [mk('c', '2026-10-05T10:00:00Z')], 1)
    expect((await sync.listFeed(fbId)).map((p) => p.externalId).sort()).toEqual(['b', 'c'])
  })

  it('publishes to Facebook and LinkedIn, marks a refused page for reconnecting, and retries only what failed', async () => {
    const calls: string[] = []
    let linkedinOk = false
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
      if (url.includes('graph.facebook.com') && url.endsWith('/fbpage1/feed')) return json({ id: 'fbpage1_99' })
      if (url.includes('graph.facebook.com') && url.includes('/fbpage1_99')) return json({ permalink_url: 'https://www.facebook.com/fbpage1/posts/99' })
      if (url.includes('api.linkedin.com/rest/posts')) {
        return linkedinOk ? json({}, 201, { 'x-restli-id': 'urn:li:share:555' }) : json({ message: 'Invalid access token' }, 401)
      }
      return json({ error: { message: `unexpected ${url}` } }, 500)
    }))

    const id = await posts.createPost({ body: 'Both (please)', linkUrl: 'https://example.com', images: [], connectionIds: [fbId, liId], mode: 'draft' }, 'u1')
    const first = await publish.publishPostNow(id)
    expect(first).toEqual({ ok: true, status: 'partial' })
    let post = (await posts.getPost(id))!
    expect(post.targets.find((t) => t.provider === 'facebook')).toMatchObject({ status: 'published', externalId: 'fbpage1_99', permalink: 'https://www.facebook.com/fbpage1/posts/99' })
    expect(post.targets.find((t) => t.provider === 'linkedin')).toMatchObject({ status: 'failed' })
    expect((await conns.listConnections()).find((c) => c.id === liId)?.status).toBe('needs_reauth')

    // The commentary LinkedIn saw had its brackets escaped.
    const liCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(([u]) => u.includes('/rest/posts'))
    expect(JSON.parse(String(liCall?.[1].body))).toMatchObject({ author: 'urn:li:organization:777', commentary: 'Both \\(please\\)', content: { article: { source: 'https://example.com' } } })

    // Reconnect LinkedIn, retry: Facebook is not posted a second time.
    await conns.upsertConnection({
      provider: 'linkedin', externalId: '777', name: 'Deskwell LinkedIn', pictureUrl: null, profileUrl: null,
      accessToken: 'li-token-2', refreshToken: null, tokenExpiresAt: new Date(Date.now() + 40 * 86_400_000), refreshExpiresAt: null, connectedBy: 'u1',
    })
    linkedinOk = true
    const fbPostsBefore = calls.filter((c) => c.startsWith('POST') && c.endsWith('/fbpage1/feed')).length
    expect(await publish.publishPostNow(id)).toEqual({ ok: true, status: 'published' })
    expect(calls.filter((c) => c.startsWith('POST') && c.endsWith('/fbpage1/feed')).length).toBe(fbPostsBefore)
    post = (await posts.getPost(id))!
    expect(post.targets.find((t) => t.provider === 'linkedin')).toMatchObject({ status: 'published', externalId: 'urn:li:share:555' })
    expect(await publish.publishPostNow(id)).toEqual({ ok: false, reason: 'busy' })
    expect(await publish.publishPostNow('nope')).toEqual({ ok: false, reason: 'missing' })
    vi.unstubAllGlobals()
  })

  it('runs the cron: sends due posts and leaves future ones alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'fbpage1_7' }), { status: 200 })))
    const due = await posts.createPost({ body: 'cron due', images: [], connectionIds: [fbId], mode: 'schedule', scheduledAt: '2030-01-01T00:00:00Z' }, 'u1')
    await db.$executeRawUnsafe(`UPDATE "shub_posts" SET "scheduled_at" = now() - interval '2 minutes' WHERE "id" = '${due}'`)
    const later = await posts.createPost({ body: 'cron later', images: [], connectionIds: [fbId], mode: 'schedule', scheduledAt: '2030-01-01T00:00:00Z' }, 'u1')
    const out = await publish.runDuePosts(Date.now() + 30_000)
    expect(out.published).toBe(1)
    expect((await posts.getPost(due))?.status).toBe('published')
    expect((await posts.getPost(later))?.status).toBe('scheduled')
    vi.unstubAllGlobals()
  })

  it('finds which web addresses were posted, through the networks\' wrapped links, and records what a read could not get', async () => {
    const wrapped = 'https://l.facebook.com/l.php?u=' + encodeURIComponent('https://deskwell.co.uk/a-post?utm_source=facebook') + '&h=x'
    await sync.storeRemotePosts(fbId, [{
      externalId: 'link1', message: 'm', permalink: 'https://p/link1', imageUrls: [], linkUrl: wrapped, linkTitle: null,
      postedAt: new Date('2026-10-06T10:00:00Z'), likeCount: null, commentCount: null, shareCount: null,
    }], 25)
    const sched = await posts.createPost({ body: 'Read https://www.deskwell.co.uk/another/', images: [], connectionIds: [fbId], mode: 'schedule', scheduledAt: '2030-02-01T09:00:00Z' }, 'u1')
    const found = await posted.matchPostedLinks(['https://deskwell.co.uk/a-post', 'https://deskwell.co.uk/another', 'https://deskwell.co.uk/never'])
    expect(found['https://deskwell.co.uk/a-post']!.facebook).toMatchObject([{ state: 'published', permalink: 'https://p/link1' }])
    expect(found['https://deskwell.co.uk/another']!.facebook).toMatchObject([{ state: 'scheduled' }])
    expect(found['https://deskwell.co.uk/never']).toEqual({ facebook: [], linkedin: [] })
    await posts.deletePost(sched)

    await conns.markSynced(fbId, 'Facebook would not share counts.')
    expect((await conns.listConnections()).find((c) => c.id === fbId)?.readNotice).toBe('Facebook would not share counts.')
    await conns.markSynced(fbId, null)
    expect((await conns.listConnections()).find((c) => c.id === fbId)?.readNotice).toBeNull()
  })

  it('deletes a post from the network first, then forgets it here; a refusal changes nothing', async () => {
    const mk = (id: string) => ({
      externalId: id, message: `m ${id}`, permalink: `https://p/${id}`, imageUrls: [], linkUrl: null, linkTitle: null,
      postedAt: new Date('2026-10-07T10:00:00Z'), likeCount: null, commentCount: null, shareCount: null,
    })
    await sync.storeRemotePosts(fbId, [mk('del1'), mk('del2')], 25)
    const own = await posts.createPost({ body: 'del1', images: [], connectionIds: [fbId], mode: 'draft' }, 'u1')
    await posts.finishTarget((await posts.getPost(own))!.targets[0]!.id, { ok: true, externalId: 'del1', permalink: null })

    let refuse = false
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${String(input)}`)
      return refuse
        ? new Response(JSON.stringify({ error: { code: 200, message: 'no permission' } }), { status: 403 })
        : new Response(JSON.stringify({ success: true }), { status: 200 })
    }))

    await expect(remote.deleteRemotePost(fbId, 'never-listed')).rejects.toThrow(/not in the list/)
    expect(seen).toEqual([])

    refuse = true
    await expect(remote.deleteRemotePost(fbId, 'del2')).rejects.toThrow(/permission/)
    expect((await sync.listFeed(fbId)).some((p) => p.externalId === 'del2')).toBe(true)

    refuse = false
    expect(await remote.deleteRemotePost(fbId, 'del1')).toEqual({ outcome: 'deleted', provider: 'facebook' })
    expect(seen.at(-1)).toMatch(/^DELETE .*graph\.facebook\.com.*del1/)
    expect((await sync.listFeed(fbId)).some((p) => p.externalId === 'del1')).toBe(false)
    expect(await posts.getPost(own)).toBeNull()
    vi.unstubAllGlobals()
  })

  it('keeps a social post waiting on a Gazette article, arms it when the article is scheduled or published, and stands it down again', async () => {
    const article = {
      id: 'gz-1', title: 'Desk news', excerpt: 'All about desks', url: 'https://site.test/desk-news', imageUrl: '/media/desk.jpg',
      status: 'DRAFT' as const, liveAt: null, isPrivate: false,
    }
    const first = await follow.saveLinked({ article, body: 'Read this', connectionIds: [fbId], sourceAt: null, go: false }, 'u1')
    expect(first.dueNow).toBe(false)
    let linked = await follow.linkedPost('gz-1')
    expect(linked).toMatchObject({ id: first.id, status: 'draft', body: 'Read this', linkUrl: 'https://site.test/desk-news', linkImageUrl: '/media/desk.jpg', sourceAt: null })

    // Saved again: the same row, not a second one.
    const again = await follow.saveLinked({ article, body: 'Read this now', connectionIds: [fbId], sourceAt: null, go: false }, 'u1')
    expect(again.id).toBe(first.id)

    // Gazette schedules the article: the post is armed for the same moment, carrying the article's latest headline.
    const liveAt = '2030-03-01T09:00:00.000Z'
    await follow.socialHubGazettePostStatus({ action: 'schedule', postId: 'gz-1', post: { ...article, title: 'Desk news (revised)', status: 'SCHEDULED', liveAt } })
    linked = await follow.linkedPost('gz-1')
    expect(linked).toMatchObject({ status: 'scheduled', scheduledAt: liveAt, linkTitle: 'Desk news (revised)', body: 'Read this now' })

    // The owner's own, later time wins; an earlier one never beats the article.
    await follow.saveLinked({ article: { ...article, status: 'SCHEDULED', liveAt }, body: 'Later', connectionIds: [fbId], sourceAt: '2030-03-02T12:00:00.000Z', go: false }, 'u1')
    expect((await follow.linkedPost('gz-1'))).toMatchObject({ status: 'scheduled', scheduledAt: '2030-03-02T12:00:00.000Z', sourceAt: '2030-03-02T12:00:00.000Z' })
    await follow.saveLinked({ article: { ...article, status: 'SCHEDULED', liveAt }, body: 'Earlier', connectionIds: [fbId], sourceAt: '2030-01-01T00:00:00.000Z', go: false }, 'u1')
    expect((await follow.linkedPost('gz-1'))?.scheduledAt).toBe(liveAt)

    // Back to draft, then private: waiting again, nothing goes out.
    await follow.socialHubGazettePostStatus({ action: 'unpublish', postId: 'gz-1', post: { ...article } })
    expect(await follow.linkedPost('gz-1')).toMatchObject({ status: 'draft', scheduledAt: null })
    await follow.socialHubGazettePostStatus({ action: 'publish', postId: 'gz-1', post: { ...article, status: 'PUBLISHED', liveAt: new Date().toISOString(), isPrivate: true } })
    expect((await follow.linkedPost('gz-1'))?.status).toBe('draft')

    // Published for real: due straight away (outside a request the cron sends it).
    await follow.saveLinked({ article, body: 'Now', connectionIds: [fbId], sourceAt: null, go: false }, 'u1')
    await follow.socialHubGazettePostStatus({ action: 'publish', postId: 'gz-1', post: { ...article, status: 'PUBLISHED', liveAt: new Date(Date.now() - 1000).toISOString() } })
    linked = await follow.linkedPost('gz-1')
    expect(linked?.status).toBe('scheduled')
    expect(Date.parse(linked!.scheduledAt!)).toBeLessThanOrEqual(Date.now())

    // Already live and the owner presses Post now.
    const live = { ...article, id: 'gz-2', status: 'PUBLISHED' as const, liveAt: '2026-01-01T00:00:00.000Z' }
    const drafted = await follow.saveLinked({ article: live, body: 'Old one', connectionIds: [fbId], sourceAt: null, go: false }, 'u1')
    expect(drafted.dueNow).toBe(false)
    expect((await follow.linkedPost('gz-2'))?.status).toBe('draft')
    expect((await follow.saveLinked({ article: live, body: 'Old one', connectionIds: [fbId], sourceAt: null, go: true }, 'u1')).dueNow).toBe(true)

    // Untick everything: gone. Delete the article: gone.
    expect((await follow.saveLinked({ article: live, body: '', connectionIds: [], sourceAt: null, go: false }, 'u1')).id).toBeNull()
    expect(await follow.linkedPost('gz-2')).toBeNull()
    await follow.socialHubGazettePostStatus({ action: 'delete', postId: 'gz-1', post: null })
    expect(await follow.linkedPost('gz-1')).toBeNull()
    // An article nobody ticked anything for is simply ignored.
    await follow.socialHubGazettePostStatus({ action: 'publish', postId: 'gz-none', post: { ...article, id: 'gz-none', status: 'PUBLISHED', liveAt: null } })
  })

  it('removes a page\'s posts and targets when it is disconnected', async () => {
    expect(await conns.deleteConnection(liId)).toBe(true)
    const left = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "shub_post_targets" WHERE "connection_id" = '${liId}'`)
    expect(Number(left[0]!.n)).toBe(0)
    expect(await conns.deleteConnection(liId)).toBe(false)
  })
})
