import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { PostInputData } from '@/modules/social-hub/lib/rules'
import type { Post, PostImage, PostStatus, PostTarget, Provider, TargetStatus } from '@/modules/social-hub/lib/types'

type PostRow = {
  id: string
  body: string
  link_url: string | null
  link_title: string | null
  link_description: string | null
  link_image_url: string | null
  images: unknown
  status: PostStatus
  scheduled_at: Date | null
  published_at: Date | null
  created_at: Date
}

type TargetRow = {
  id: string
  post_id: string
  connection_id: string
  provider: Provider
  connection_name: string
  status: TargetStatus
  external_id: string | null
  permalink: string | null
  error: string | null
}

const POST_COLUMNS = Prisma.sql`"id", "body", "link_url", "link_title", "link_description", "link_image_url",
  "images", "status", "scheduled_at", "published_at", "created_at"`

function readImages(value: unknown): PostImage[] {
  if (!Array.isArray(value)) return []
  const out: PostImage[] = []
  for (const item of value) {
    if (item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string') {
      const alt = (item as { alt?: unknown }).alt
      out.push({ url: (item as { url: string }).url, ...(typeof alt === 'string' && alt ? { alt } : {}) })
    }
  }
  return out
}

function toPost(row: PostRow, targets: TargetRow[]): Post {
  return {
    id: row.id,
    body: row.body,
    linkUrl: row.link_url,
    linkTitle: row.link_title,
    linkDescription: row.link_description,
    linkImageUrl: row.link_image_url,
    images: readImages(row.images),
    status: row.status,
    scheduledAt: row.scheduled_at?.toISOString() ?? null,
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    targets: targets.map(
      (t): PostTarget => ({
        id: t.id,
        connectionId: t.connection_id,
        provider: t.provider,
        connectionName: t.connection_name,
        status: t.status,
        externalId: t.external_id,
        permalink: t.permalink,
        error: t.error,
      }),
    ),
  }
}

async function targetsFor(postIds: string[]): Promise<TargetRow[]> {
  if (postIds.length === 0) return []
  return prisma.$queryRaw<TargetRow[]>`
    SELECT t."id", t."post_id", t."connection_id", c."provider", c."name" AS "connection_name",
           t."status", t."external_id", t."permalink", t."error"
    FROM "shub_post_targets" t
    JOIN "shub_connections" c ON c."id" = t."connection_id"
    WHERE t."post_id" IN (${Prisma.join(postIds)})
    ORDER BY c."provider", c."name"
  `
}

export async function getPost(id: string): Promise<Post | null> {
  const rows = await prisma.$queryRaw<PostRow[]>`SELECT ${POST_COLUMNS} FROM "shub_posts" WHERE "id" = ${id}`
  const row = rows[0]
  if (!row) return null
  return toPost(row, await targetsFor([id]))
}

/** Posts in the given states. Scheduled ones come soonest-first; everything else newest-first. */
export async function listPosts(statuses: PostStatus[], limit = 100): Promise<Post[]> {
  const scheduledFirst = statuses.length > 0 && statuses.every((s) => s === 'scheduled')
  const order = scheduledFirst ? Prisma.sql`"scheduled_at" ASC` : Prisma.sql`"created_at" DESC`
  const rows = await prisma.$queryRaw<PostRow[]>`
    SELECT ${POST_COLUMNS} FROM "shub_posts"
    WHERE "status" IN (${Prisma.join(statuses)})
    ORDER BY ${order} LIMIT ${limit}
  `
  const targets = await targetsFor(rows.map((r) => r.id))
  return rows.map((r) => toPost(r, targets.filter((t) => t.post_id === r.id)))
}

export async function countPosts(): Promise<Record<PostStatus, number>> {
  const rows = await prisma.$queryRaw<{ status: PostStatus; n: bigint }[]>`
    SELECT "status", COUNT(*) AS "n" FROM "shub_posts" GROUP BY "status"
  `
  const out: Record<PostStatus, number> = { draft: 0, scheduled: 0, publishing: 0, published: 0, partial: 0, failed: 0 }
  for (const r of rows) out[r.status] = Number(r.n)
  return out
}

function statusFor(mode: PostInputData['mode']): PostStatus {
  return mode === 'draft' ? 'draft' : mode === 'schedule' ? 'scheduled' : 'draft'
}

function scheduledAtFor(input: PostInputData): Date | null {
  return input.mode === 'schedule' && input.scheduledAt ? new Date(input.scheduledAt) : null
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)

export async function createPost(input: PostInputData, userId: string): Promise<string> {
  const images = JSON.stringify(input.images)
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "shub_posts"
      ("body", "link_url", "link_title", "link_description", "link_image_url", "images", "status", "scheduled_at", "created_by")
    VALUES
      (${input.body}, ${clean(input.linkUrl)}, ${clean(input.linkTitle)}, ${clean(input.linkDescription)},
       ${clean(input.linkImageUrl)}, ${images}::jsonb, ${statusFor(input.mode)}, ${scheduledAtFor(input)}, ${userId})
    RETURNING "id"
  `
  const id = rows[0]!.id
  await setTargets(id, input.connectionIds)
  return id
}

/** Replace the contents of a post that has not gone out yet. Pages already published to are left alone. */
export async function updatePost(id: string, input: PostInputData): Promise<void> {
  const images = JSON.stringify(input.images)
  await prisma.$executeRaw`
    UPDATE "shub_posts" SET
      "body" = ${input.body}, "link_url" = ${clean(input.linkUrl)}, "link_title" = ${clean(input.linkTitle)},
      "link_description" = ${clean(input.linkDescription)}, "link_image_url" = ${clean(input.linkImageUrl)},
      "images" = ${images}::jsonb, "status" = ${statusFor(input.mode)}, "scheduled_at" = ${scheduledAtFor(input)},
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `
  await setTargets(id, input.connectionIds)
}

async function setTargets(postId: string, connectionIds: string[]): Promise<void> {
  const unique = [...new Set(connectionIds)]
  if (unique.length === 0) {
    await prisma.$executeRaw`DELETE FROM "shub_post_targets" WHERE "post_id" = ${postId} AND "status" <> 'published'`
  } else {
    await prisma.$executeRaw`
      DELETE FROM "shub_post_targets"
      WHERE "post_id" = ${postId} AND "status" <> 'published' AND "connection_id" NOT IN (${Prisma.join(unique)})
    `
  }
  for (const connectionId of unique) {
    await prisma.$executeRaw`
      INSERT INTO "shub_post_targets" ("post_id", "connection_id") VALUES (${postId}, ${connectionId})
      ON CONFLICT ("post_id", "connection_id") DO NOTHING
    `
  }
}

export async function deletePost(id: string): Promise<boolean> {
  const n = await prisma.$executeRaw`DELETE FROM "shub_posts" WHERE "id" = ${id} AND "status" <> 'publishing'`
  return n > 0
}

/** Take hold of one post so only one runner publishes it. Null if somebody else has it or it is not publishable. */
export async function claimPost(id: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "shub_posts" SET "status" = 'publishing', "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id} AND "status" IN ('draft', 'scheduled', 'failed', 'partial')
    RETURNING "id"
  `
  return rows.length > 0
}

export async function claimNextDue(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "shub_posts" SET "status" = 'publishing', "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = (
      SELECT "id" FROM "shub_posts"
      WHERE "status" = 'scheduled' AND "scheduled_at" <= CURRENT_TIMESTAMP
      ORDER BY "scheduled_at" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"
  `
  return rows[0]?.id ?? null
}

export type TargetWork = { id: string; connectionId: string; status: TargetStatus }

export async function pendingTargets(postId: string): Promise<TargetWork[]> {
  const rows = await prisma.$queryRaw<{ id: string; connection_id: string; status: TargetStatus }[]>`
    SELECT "id", "connection_id", "status" FROM "shub_post_targets"
    WHERE "post_id" = ${postId} AND "status" IN ('pending', 'failed')
    ORDER BY "id"
  `
  return rows.map((r) => ({ id: r.id, connectionId: r.connection_id, status: r.status }))
}

export async function startTarget(targetId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "shub_post_targets" SET "status" = 'publishing', "attempts" = "attempts" + 1, "error" = NULL WHERE "id" = ${targetId}
  `
}

export async function finishTarget(
  targetId: string,
  result: { ok: true; externalId: string; permalink: string | null } | { ok: false; error: string },
): Promise<void> {
  if (result.ok) {
    await prisma.$executeRaw`
      UPDATE "shub_post_targets" SET "status" = 'published', "external_id" = ${result.externalId},
        "permalink" = ${result.permalink}, "error" = NULL, "published_at" = CURRENT_TIMESTAMP WHERE "id" = ${targetId}
    `
  } else {
    await prisma.$executeRaw`
      UPDATE "shub_post_targets" SET "status" = 'failed', "error" = ${result.error.slice(0, 500)} WHERE "id" = ${targetId}
    `
  }
}

/** Work out a post's overall state from its pages, and settle it there. */
export async function settlePost(postId: string): Promise<PostStatus> {
  const rows = await prisma.$queryRaw<{ status: TargetStatus; n: bigint }[]>`
    SELECT "status", COUNT(*) AS "n" FROM "shub_post_targets" WHERE "post_id" = ${postId} GROUP BY "status"
  `
  const count = (s: TargetStatus) => Number(rows.find((r) => r.status === s)?.n ?? 0)
  const published = count('published')
  const total = rows.reduce((sum, r) => sum + Number(r.n), 0)
  const status: PostStatus = total > 0 && published === total ? 'published' : published > 0 ? 'partial' : 'failed'
  await prisma.$executeRaw`
    UPDATE "shub_posts" SET "status" = ${status},
      "published_at" = CASE WHEN ${published > 0} THEN COALESCE("published_at", CURRENT_TIMESTAMP) ELSE "published_at" END,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${postId}
  `
  return status
}

/** A runner that died mid-post leaves it "publishing" for ever. Fail those targets so a person can look and retry. */
export async function releaseStalePosts(): Promise<number> {
  const stale = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "shub_posts" WHERE "status" = 'publishing' AND "updated_at" < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
  `
  for (const { id } of stale) {
    await prisma.$executeRaw`
      UPDATE "shub_post_targets" SET "status" = 'failed',
        "error" = 'This was interrupted part way. Check the page before retrying, in case it went out.'
      WHERE "post_id" = ${id} AND "status" = 'publishing'
    `
    await settlePost(id)
  }
  return stale.length
}

export async function failedPostCount(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS "n" FROM "shub_posts"
    WHERE "status" IN ('failed', 'partial') AND "updated_at" > CURRENT_TIMESTAMP - INTERVAL '7 days'
  `
  return Number(rows[0]?.n ?? 0)
}
