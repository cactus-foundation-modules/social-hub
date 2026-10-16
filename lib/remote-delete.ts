import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import { getConnectionWithSecrets, markNeedsReauth } from '@/modules/social-hub/lib/connections'
import { deleteFacebookPost } from '@/modules/social-hub/lib/facebook'
import { deleteLinkedInPost } from '@/modules/social-hub/lib/linkedin'
import { usableToken } from '@/modules/social-hub/lib/tokens'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import { SocialError } from '@/modules/social-hub/lib/types'

export type RemoteDeleteResult = { outcome: 'deleted' | 'gone'; provider: 'facebook' | 'linkedin' }

/**
 * Delete a post from the Facebook or LinkedIn page it is on, then forget it here. The
 * network is asked first: if it refuses, nothing local changes, so the screen never
 * says a post is gone while it is still live. Only a post this site has actually listed
 * can be deleted - an identifier typed by hand is refused.
 */
export async function deleteRemotePost(connectionId: string, externalId: string): Promise<RemoteDeleteResult> {
  const known = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS "n" FROM "shub_remote_posts" WHERE "connection_id" = ${connectionId} AND "external_id" = ${externalId}
  `
  if (Number(known[0]?.n ?? 0) === 0) throw new SocialError('That post is not in the list any more. Refresh and try again.')

  const conn = await getConnectionWithSecrets(connectionId)
  if (!conn) throw new SocialError('That page is no longer connected.')
  if (conn.status !== 'active') throw new SocialError(`${conn.name} needs reconnecting before posts can be deleted from it.`, true)

  let outcome: 'deleted' | 'gone'
  try {
    const token = await usableToken(conn)
    outcome = conn.provider === 'facebook' ? await deleteFacebookPost(token, externalId) : await deleteLinkedInPost(token, externalId)
  } catch (err) {
    if (err instanceof SocialError && err.authFailure) {
      await markNeedsReauth(conn.id, err.message)
      await syncAttentionAlert()
    }
    throw err
  }

  await forgetRemotePost(connectionId, externalId)
  return { outcome, provider: conn.provider }
}

/** Drop the cached copy, and Social Hub's own record of having posted it, so nothing still claims it is live. */
async function forgetRemotePost(connectionId: string, externalId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const targets = await tx.$queryRaw<{ post_id: string }[]>`
      DELETE FROM "shub_post_targets" WHERE "connection_id" = ${connectionId} AND "external_id" = ${externalId}
      RETURNING "post_id"
    `
    await tx.$executeRaw`DELETE FROM "shub_remote_posts" WHERE "connection_id" = ${connectionId} AND "external_id" = ${externalId}`
    const ids = [...new Set(targets.map((t) => t.post_id))]
    if (ids.length > 0) {
      // A post whose only page was this one has nothing left to describe. One that also went elsewhere stays.
      await tx.$executeRaw`
        DELETE FROM "shub_posts" p
        WHERE p."id" IN (${Prisma.join(ids)})
          AND NOT EXISTS (SELECT 1 FROM "shub_post_targets" t WHERE t."post_id" = p."id")
      `
    }
  })
}
