import { prisma } from '@/lib/db/prisma'
import { getConnectionWithSecrets, markNeedsReauth } from '@/modules/social-hub/lib/connections'
import { updateFacebookPost } from '@/modules/social-hub/lib/facebook'
import { usableToken } from '@/modules/social-hub/lib/tokens'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import { LIMITS, SocialError } from '@/modules/social-hub/lib/types'

/**
 * Change the text of a post already on a Facebook page, then update the cached copy so the
 * list shows it at once. The network is asked first: if it refuses, nothing local changes.
 * Only a post this site has actually listed can be edited, and only on Facebook - LinkedIn
 * posts are read and deleted here, not rewritten.
 */
export async function editRemotePost(connectionId: string, externalId: string, message: string): Promise<void> {
  const text = message.trim()
  if (!text) throw new SocialError('A post needs some words. To remove it, use Delete instead.')
  if (text.length > LIMITS.bodyMax) throw new SocialError(`That is ${text.length} characters; the most allowed is ${LIMITS.bodyMax}.`)

  const known = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS "n" FROM "shub_remote_posts" WHERE "connection_id" = ${connectionId} AND "external_id" = ${externalId}
  `
  if (Number(known[0]?.n ?? 0) === 0) throw new SocialError('That post is not in the list any more. Refresh and try again.')

  const conn = await getConnectionWithSecrets(connectionId)
  if (!conn) throw new SocialError('That page is no longer connected.')
  if (conn.provider !== 'facebook') throw new SocialError('Only Facebook posts can be edited from here.')
  if (conn.status !== 'active') throw new SocialError(`${conn.name} needs reconnecting before posts can be edited.`, true)

  try {
    const token = await usableToken(conn)
    await updateFacebookPost(token, externalId, text)
  } catch (err) {
    if (err instanceof SocialError && err.authFailure) {
      await markNeedsReauth(conn.id, err.message)
      await syncAttentionAlert()
    }
    throw err
  }

  await prisma.$executeRaw`
    UPDATE "shub_remote_posts" SET "message" = ${text}
    WHERE "connection_id" = ${connectionId} AND "external_id" = ${externalId}
  `
}
