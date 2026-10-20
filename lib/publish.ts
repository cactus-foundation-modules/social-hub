import { absoluteUrl } from '@/modules/social-hub/lib/media-url'
import { getConnectionWithSecrets, markNeedsReauth, noteConnectionError } from '@/modules/social-hub/lib/connections'
import { findPublishedOnFacebook, publishToFacebook } from '@/modules/social-hub/lib/facebook'
import { publishToLinkedIn } from '@/modules/social-hub/lib/linkedin'
import {
  claimNextDue, claimNextRetry, claimPost, finishTarget, getPost, isRetryOwed, pendingTargets, releaseStalePosts, settlePost, startTarget,
  type TargetWork,
} from '@/modules/social-hub/lib/posts'
import type { PublishInput, PublishResult } from '@/modules/social-hub/lib/provider-types'
import { usableToken } from '@/modules/social-hub/lib/tokens'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import { outcomeUncertain, SocialError, UNCHECKED_ERROR, type Post, type PostStatus } from '@/modules/social-hub/lib/types'

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

/** Who started this run: a person pressing Post now, the cron sending what is due, or the cron's one retry of a timeout. */
type RunMode = 'manual' | 'due' | 'retry'

/**
 * Before sending again after an attempt that never got an answer, look at the page: Facebook sometimes
 * takes the post and still fails to say so. Answers the post if it is already there. When the page cannot
 * be read, a person's retry goes ahead (they chose it) but the cron's does not, because a double post on
 * the public page is worse than a late one.
 */
async function alreadyOnFacebook(post: Post, target: TargetWork, pageId: string, token: string, input: PublishInput, mode: RunMode): Promise<PublishResult | null> {
  if (target.provider !== 'facebook' || target.attempts === 0 || !outcomeUncertain(target.error)) return null
  try {
    return await findPublishedOnFacebook(pageId, token, input, new Date(post.createdAt))
  } catch (err) {
    if (err instanceof SocialError && err.authFailure) throw err
    if (mode !== 'manual') throw new SocialError(UNCHECKED_ERROR)
    return null
  }
}

async function publishTarget(post: Post, target: TargetWork, mode: RunMode): Promise<void> {
  await startTarget(target.id)
  try {
    const conn = await getConnectionWithSecrets(target.connectionId)
    if (!conn) throw new SocialError('This page has been disconnected.')
    if (conn.status !== 'active') throw new SocialError('This page needs reconnecting before it can be posted to.', true)
    const token = await usableToken(conn)
    const input = inputFor(post)
    const result: PublishResult =
      (await alreadyOnFacebook(post, target, conn.externalId, token, input, mode)) ??
      (conn.provider === 'facebook'
        ? await publishToFacebook(conn.externalId, token, input)
        : await publishToLinkedIn(conn.externalId, token, input))
    await finishTarget(target.id, { ok: true, ...result })
  } catch (err) {
    const message = err instanceof SocialError ? err.message : 'Something unexpected went wrong while posting.'
    await finishTarget(target.id, { ok: false, error: message })
    if (err instanceof SocialError && err.authFailure) await markNeedsReauth(target.connectionId, message)
    else await noteConnectionError(target.connectionId, message).catch(() => undefined)
  }
}

/** Send a claimed post to every page that has not got it yet, then settle its overall state. */
async function runClaimed(postId: string, mode: RunMode): Promise<PostStatus> {
  const post = await getPost(postId)
  if (!post) return 'failed'
  const work = await pendingTargets(postId)
  // The cron's retry only touches the pages that timed out, never one that was refused for a real reason.
  for (const target of mode === 'retry' ? work.filter(isRetryOwed) : work) await publishTarget(post, target, mode)
  return settlePost(postId)
}

export type PublishNowResult = { ok: true; status: PostStatus } | { ok: false; reason: 'busy' | 'missing' }

/** Publish (or retry) one post right now, whatever time it was scheduled for. */
export async function publishPostNow(postId: string): Promise<PublishNowResult> {
  if (!(await getPost(postId))) return { ok: false, reason: 'missing' }
  if (!(await claimPost(postId))) return { ok: false, reason: 'busy' }
  const status = await runClaimed(postId, 'manual')
  await syncAttentionAlert()
  return { ok: true, status }
}

/**
 * How long the cron keeps starting new posts. The function dies at 60s and one Facebook post can wait
 * 30s for the post and 15s more for its link, so nothing new starts after 15s.
 */
export const PUBLISH_BUDGET_MS = 15_000

/** The cron's job: publish every scheduled post that has come due, then retry any that timed out, within the time the dispatcher allows. */
export async function runDuePosts(deadline: number): Promise<{ published: number; retried: number; stale: number }> {
  const stale = await releaseStalePosts()
  let published = 0
  while (Date.now() < deadline) {
    const id = await claimNextDue()
    if (!id) break
    await runClaimed(id, 'due')
    published += 1
  }
  let retried = 0
  while (Date.now() < deadline) {
    const id = await claimNextRetry()
    if (!id) break
    await runClaimed(id, 'retry')
    retried += 1
  }
  if (published > 0 || retried > 0 || stale > 0) await syncAttentionAlert()
  return { published, retried, stale }
}
