import { after } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getPost, updatePost, createPost } from '@/modules/social-hub/lib/posts'
import { publishPostNow } from '@/modules/social-hub/lib/publish'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import type { Post } from '@/modules/social-hub/lib/types'

// A social post that follows a Gazette article: ticked in the article's editor,
// it waits here as a draft and goes out when the article does. Gazette tells us
// through `gazette.post-status-changed`; nothing here imports Gazette, because
// Social Hub has to build and run on a site that has none. The shapes below are
// our copy of Gazette's contract.

export const SOURCE_KIND = 'gazette'

export type GazetteArticle = {
  id: string
  title: string
  excerpt: string | null
  url: string
  imageUrl: string | null
  status: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED'
  liveAt: string | null
  isPrivate: boolean
}

type StatusChange = {
  action: 'publish' | 'schedule' | 'unpublish' | 'delete'
  post: GazetteArticle | null
  postId: string
}

/** States in which the post has not gone anywhere yet, so it may still change. */
export const UNSENT = ['draft', 'scheduled', 'failed'] as const

export async function linkedPostId(articleId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "shub_posts" WHERE "source_kind" = ${SOURCE_KIND} AND "source_id" = ${articleId}
  `
  return rows[0]?.id ?? null
}

export async function linkedPost(articleId: string): Promise<(Post & { sourceAt: string | null }) | null> {
  const rows = await prisma.$queryRaw<{ id: string; source_at: Date | null }[]>`
    SELECT "id", "source_at" FROM "shub_posts" WHERE "source_kind" = ${SOURCE_KIND} AND "source_id" = ${articleId}
  `
  const row = rows[0]
  if (!row) return null
  const post = await getPost(row.id)
  return post ? { ...post, sourceAt: row.source_at?.toISOString() ?? null } : null
}

/** The moment the social post should go: the article's own time, or the owner's, whichever is later. */
export function dueAt(liveAt: string | null, sourceAt: string | null, now = Date.now()): Date {
  const live = liveAt ? Date.parse(liveAt) : now
  const own = sourceAt ? Date.parse(sourceAt) : live
  return new Date(Math.max(Number.isFinite(live) ? live : now, Number.isFinite(own) ? own : live))
}

export type SaveLinked = {
  article: GazetteArticle
  body: string
  connectionIds: string[]
  sourceAt: string | null
  /** True once the article is live and the owner pressed Post / Schedule here. */
  go: boolean
}

/**
 * Create or replace the post that follows an article. Untick every page and it
 * is removed. Armed (scheduled) when the article is already scheduled, when it
 * was armed before, or when the owner says go; otherwise it waits as a draft.
 */
export async function saveLinked(input: SaveLinked, userId: string): Promise<{ id: string | null; dueNow: boolean }> {
  const { article } = input
  const existingId = await linkedPostId(article.id)
  const existing = existingId ? await getPost(existingId) : null

  if (input.connectionIds.length === 0) {
    if (existingId) await prisma.$executeRaw`DELETE FROM "shub_posts" WHERE "id" = ${existingId} AND "status" IN ('draft', 'scheduled', 'failed')`
    return { id: null, dueNow: false }
  }

  const shareable = !article.isPrivate && article.status !== 'DRAFT'
  const armed = shareable && (article.status === 'SCHEDULED' || existing?.status === 'scheduled' || input.go)
  const when = dueAt(article.liveAt, input.sourceAt)
  const fields = {
    body: input.body,
    linkUrl: article.url,
    linkTitle: article.title,
    linkDescription: article.excerpt,
    linkImageUrl: null,
    images: [],
    connectionIds: input.connectionIds,
    mode: armed ? ('schedule' as const) : ('draft' as const),
    scheduledAt: armed ? when.toISOString() : null,
  }

  let id: string
  if (existingId) {
    await updatePost(existingId, fields)
    id = existingId
  } else {
    id = await createPost(fields, userId)
  }
  // The link card's picture is kept out of the shared fields above: PostInput
  // insists on a full web address, and a featured image is usually a site path.
  await prisma.$executeRaw`
    UPDATE "shub_posts" SET "source_kind" = ${SOURCE_KIND}, "source_id" = ${article.id},
      "source_at" = ${input.sourceAt ? new Date(input.sourceAt) : null}, "link_image_url" = ${article.imageUrl}
    WHERE "id" = ${id}
  `
  return { id, dueNow: armed && when.getTime() <= Date.now() }
}

/** Publish now if it is due, after the response has gone so the editor is not kept waiting. */
function sendSoon(postId: string): void {
  try {
    after(async () => { await publishPostNow(postId) })
  } catch {
    // Outside a request (a script, a test): the five-minute cron picks it up instead.
  }
}

/** Listener for `gazette.post-status-changed`. */
export async function socialHubGazettePostStatus(change: StatusChange): Promise<void> {
  const id = await linkedPostId(change.postId)
  if (!id) return

  if (change.action === 'delete') {
    await prisma.$executeRaw`DELETE FROM "shub_posts" WHERE "id" = ${id} AND "status" IN ('draft', 'scheduled', 'failed')`
    await syncAttentionAlert()
    return
  }

  const article = change.post
  if (change.action === 'unpublish' || !article || article.isPrivate) {
    // Back to waiting: an article that is not public has nothing to link to.
    await prisma.$executeRaw`
      UPDATE "shub_posts" SET "status" = 'draft', "scheduled_at" = NULL, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id} AND "status" = 'scheduled'
    `
    return
  }

  // Published or scheduled: arm it, carrying the article's current address and
  // headline in case either changed since the post was written.
  const rows = await prisma.$queryRaw<{ source_at: Date | null; targets: bigint }[]>`
    SELECT p."source_at", (SELECT COUNT(*) FROM "shub_post_targets" t WHERE t."post_id" = p."id") AS "targets"
    FROM "shub_posts" p WHERE p."id" = ${id} AND p."status" IN ('draft', 'scheduled')
  `
  const row = rows[0]
  if (!row || Number(row.targets) === 0) return
  const when = dueAt(article.liveAt, row.source_at?.toISOString() ?? null)
  await prisma.$executeRaw`
    UPDATE "shub_posts" SET "status" = 'scheduled', "scheduled_at" = ${when},
      "link_url" = ${article.url}, "link_title" = ${article.title}, "link_description" = ${article.excerpt},
      "link_image_url" = ${article.imageUrl}, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `
  if (when.getTime() <= Date.now()) sendSoon(id)
}
