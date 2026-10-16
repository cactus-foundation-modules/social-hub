import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { listActiveWithSecrets, markNeedsReauth, markSynced, noteConnectionError, type ConnectionSecrets } from '@/modules/social-hub/lib/connections'
import { fetchFacebookPosts } from '@/modules/social-hub/lib/facebook'
import { fetchLinkedInPosts } from '@/modules/social-hub/lib/linkedin'
import type { RemotePostInput } from '@/modules/social-hub/lib/provider-types'
import { usableToken } from '@/modules/social-hub/lib/tokens'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import { SocialError, type Connection, type RemotePost } from '@/modules/social-hub/lib/types'

const FETCH_SIZE = { facebook: 25, linkedin: 20 } as const

export async function storeRemotePosts(connectionId: string, posts: RemotePostInput[], pageSize: number): Promise<void> {
  for (const p of posts) {
    await prisma.$executeRaw`
      INSERT INTO "shub_remote_posts"
        ("connection_id", "external_id", "message", "permalink", "image_urls", "link_url", "link_title",
         "posted_at", "like_count", "comment_count", "share_count", "fetched_at")
      VALUES
        (${connectionId}, ${p.externalId}, ${p.message}, ${p.permalink}, ${JSON.stringify(p.imageUrls)}::jsonb,
         ${p.linkUrl}, ${p.linkTitle}, ${p.postedAt}, ${p.likeCount}, ${p.commentCount}, ${p.shareCount}, CURRENT_TIMESTAMP)
      ON CONFLICT ("connection_id", "external_id") DO UPDATE SET
        "message" = EXCLUDED."message", "permalink" = EXCLUDED."permalink", "image_urls" = EXCLUDED."image_urls",
        "link_url" = EXCLUDED."link_url", "link_title" = EXCLUDED."link_title", "posted_at" = EXCLUDED."posted_at",
        "like_count" = EXCLUDED."like_count", "comment_count" = EXCLUDED."comment_count",
        "share_count" = EXCLUDED."share_count", "fetched_at" = CURRENT_TIMESTAMP
    `
  }
  // Forget posts that were deleted on the network. When we only got a page of recent
  // posts, only those newer than the oldest one we got can be judged missing.
  const ids = posts.map((p) => p.externalId)
  if (posts.length < pageSize) {
    if (ids.length === 0) {
      await prisma.$executeRaw`DELETE FROM "shub_remote_posts" WHERE "connection_id" = ${connectionId}`
    } else {
      await prisma.$executeRaw`
        DELETE FROM "shub_remote_posts" WHERE "connection_id" = ${connectionId} AND "external_id" NOT IN (${Prisma.join(ids)})
      `
    }
    return
  }
  const dated = posts.map((p) => p.postedAt?.getTime()).filter((t): t is number => typeof t === 'number')
  if (dated.length === 0) return
  const oldest = new Date(Math.min(...dated))
  await prisma.$executeRaw`
    DELETE FROM "shub_remote_posts"
    WHERE "connection_id" = ${connectionId} AND "posted_at" >= ${oldest} AND "external_id" NOT IN (${Prisma.join(ids)})
  `
}

export type SyncOutcome = { connectionId: string; ok: boolean; error?: string; count?: number }

export async function syncConnection(conn: ConnectionSecrets): Promise<SyncOutcome> {
  try {
    const token = await usableToken(conn)
    const size = FETCH_SIZE[conn.provider]
    const posts = conn.provider === 'facebook'
      ? await fetchFacebookPosts(conn.externalId, token)
      : await fetchLinkedInPosts(conn.externalId, token)
    await storeRemotePosts(conn.id, posts, size)
    await markSynced(conn.id)
    return { connectionId: conn.id, ok: true, count: posts.length }
  } catch (err) {
    const message = err instanceof SocialError ? err.message : 'Reading this page failed unexpectedly.'
    if (err instanceof SocialError && err.authFailure) await markNeedsReauth(conn.id, message)
    else await noteConnectionError(conn.id, message).catch(() => undefined)
    return { connectionId: conn.id, ok: false, error: message }
  }
}

/** Refresh every active page (or just one), stopping when the time allowed has run out. */
export async function syncAll(deadline: number, onlyId?: string): Promise<SyncOutcome[]> {
  const all = await listActiveWithSecrets()
  const wanted = onlyId ? all.filter((c) => c.id === onlyId) : all
  const out: SyncOutcome[] = []
  for (const conn of wanted) {
    if (Date.now() > deadline) break
    out.push(await syncConnection(conn))
  }
  await syncAttentionAlert()
  return out
}

type FeedRow = {
  connection_id: string
  provider: Connection['provider']
  connection_name: string
  external_id: string
  message: string
  permalink: string | null
  image_urls: unknown
  link_url: string | null
  link_title: string | null
  posted_at: Date | null
  like_count: number | null
  comment_count: number | null
  share_count: number | null
  via: boolean
}

export async function listFeed(connectionId: string | null, limit = 60): Promise<RemotePost[]> {
  const filter = connectionId ? Prisma.sql`WHERE r."connection_id" = ${connectionId}` : Prisma.empty
  const rows = await prisma.$queryRaw<FeedRow[]>`
    SELECT r."connection_id", c."provider", c."name" AS "connection_name", r."external_id", r."message",
           r."permalink", r."image_urls", r."link_url", r."link_title", r."posted_at",
           r."like_count", r."comment_count", r."share_count",
           EXISTS (
             SELECT 1 FROM "shub_post_targets" t
             WHERE t."connection_id" = r."connection_id" AND t."external_id" = r."external_id"
           ) AS "via"
    FROM "shub_remote_posts" r
    JOIN "shub_connections" c ON c."id" = r."connection_id"
    ${filter}
    ORDER BY r."posted_at" DESC NULLS LAST LIMIT ${limit}
  `
  return rows.map((r) => ({
    connectionId: r.connection_id,
    provider: r.provider,
    connectionName: r.connection_name,
    externalId: r.external_id,
    message: r.message,
    permalink: r.permalink,
    imageUrls: Array.isArray(r.image_urls) ? r.image_urls.filter((u): u is string => typeof u === 'string') : [],
    linkUrl: r.link_url,
    linkTitle: r.link_title,
    postedAt: r.posted_at?.toISOString() ?? null,
    likeCount: r.like_count,
    commentCount: r.comment_count,
    shareCount: r.share_count,
    viaSocialHub: r.via,
  }))
}
