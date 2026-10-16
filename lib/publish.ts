import { absoluteUrl } from '@/modules/social-hub/lib/media-url'
import { getConnectionWithSecrets, markNeedsReauth, noteConnectionError } from '@/modules/social-hub/lib/connections'
import { publishToFacebook } from '@/modules/social-hub/lib/facebook'
import { publishToLinkedIn } from '@/modules/social-hub/lib/linkedin'
import {
  claimNextDue, claimPost, finishTarget, getPost, pendingTargets, releaseStalePosts, settlePost, startTarget,
} from '@/modules/social-hub/lib/posts'
import type { PublishInput, PublishResult } from '@/modules/social-hub/lib/provider-types'
import { usableToken } from '@/modules/social-hub/lib/tokens'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import { SocialError, type Post, type PostStatus } from '@/modules/social-hub/lib/types'

function inputFor(post: Post): PublishInput {
  return {
    body: post.body,
    linkUrl: post.linkUrl,
    linkTitle: post.linkTitle,
    linkDescription: post.linkDescription,
    linkImageUrl: post.linkImageUrl ? absoluteUrl(post.linkImageUrl) : null,
    images: post.images,
  }
}

async function publishTarget(post: Post, targetId: string, connectionId: string): Promise<void> {
  await startTarget(targetId)
  try {
    const conn = await getConnectionWithSecrets(connectionId)
    if (!conn) throw new SocialError('This page has been disconnected.')
    if (conn.status !== 'active') throw new SocialError('This page needs reconnecting before it can be posted to.', true)
    const token = await usableToken(conn)
    const input = inputFor(post)
    const result: PublishResult =
      conn.provider === 'facebook'
        ? await publishToFacebook(conn.externalId, token, input)
        : await publishToLinkedIn(conn.externalId, token, input)
    await finishTarget(targetId, { ok: true, ...result })
  } catch (err) {
    const message = err instanceof SocialError ? err.message : 'Something unexpected went wrong while posting.'
    await finishTarget(targetId, { ok: false, error: message })
    if (err instanceof SocialError && err.authFailure) await markNeedsReauth(connectionId, message)
    else await noteConnectionError(connectionId, message).catch(() => undefined)
  }
}

/** Send a claimed post to every page that has not got it yet, then settle its overall state. */
async function runClaimed(postId: string): Promise<PostStatus> {
  const post = await getPost(postId)
  if (!post) return 'failed'
  const work = await pendingTargets(postId)
  for (const target of work) await publishTarget(post, target.id, target.connectionId)
  return settlePost(postId)
}

export type PublishNowResult = { ok: true; status: PostStatus } | { ok: false; reason: 'busy' | 'missing' }

/** Publish (or retry) one post right now, whatever time it was scheduled for. */
export async function publishPostNow(postId: string): Promise<PublishNowResult> {
  if (!(await getPost(postId))) return { ok: false, reason: 'missing' }
  if (!(await claimPost(postId))) return { ok: false, reason: 'busy' }
  const status = await runClaimed(postId)
  await syncAttentionAlert()
  return { ok: true, status }
}

export const PUBLISH_BUDGET_MS = 40_000

/** The cron's job: publish every scheduled post that has come due, within the time the dispatcher allows. */
export async function runDuePosts(deadline: number): Promise<{ published: number; stale: number }> {
  const stale = await releaseStalePosts()
  let published = 0
  while (Date.now() < deadline) {
    const id = await claimNextDue()
    if (!id) break
    await runClaimed(id)
    published += 1
  }
  if (published > 0 || stale > 0) await syncAttentionAlert()
  return { published, stale }
}
