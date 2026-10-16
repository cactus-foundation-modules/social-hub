import { asRecord, asString, requestJson } from '@/modules/social-hub/lib/http'
import { deleteFacebookPost, FB_GRAPH_VERSION, graphError } from '@/modules/social-hub/lib/facebook'
import { SocialError } from '@/modules/social-hub/lib/types'

export type TestCallResult = {
  permission: string
  what: string
  ok: boolean
  detail: string
}

const GRAPH = `https://graph.facebook.com/${FB_GRAPH_VERSION}`
const TEST_MESSAGE = 'Social Hub connection test. This post is removed again straight away.'

function failure(permission: string, what: string, err: unknown): TestCallResult {
  const detail = err instanceof SocialError ? err.message : 'Facebook did not answer.'
  return { permission, what, ok: false, detail }
}

/**
 * Make, with a connected page's own token, the calls Meta's App Review looks for. Meta only
 * counts a call that succeeded, so each one is reported on its own. The publish test puts a
 * short post on the page and deletes it again; if the delete fails the result says so and
 * names the post, so it is never left behind quietly.
 *
 * `pages_show_list` and `public_profile` are not here: they need the signed-in person's own
 * token, which is only available while connecting, so connecting is their test.
 */
export async function runFacebookTestCalls(pageId: string, token: string): Promise<TestCallResult[]> {
  const headers = { authorization: `Bearer ${token}` }
  const results: TestCallResult[] = []

  // One field at a time, so a refusal names the field Facebook objects to rather than the whole request.
  const probes: Array<[string, string, string?]> = [
    ['message,created_time', 'Read the page\'s posts'],
    ['shares', 'Read share counts'],
    ['reactions.limit(0).summary(true)', 'Read reaction counts', 'pages_read_user_content'],
    ['likes.limit(0).summary(true)', 'Read like counts', 'pages_read_user_content'],
    ['comments.limit(0).summary(true)', 'Read comment counts', 'pages_read_user_content'],
  ]
  for (const [fields, what, permission = 'pages_read_engagement'] of probes) {
    try {
      const query = new URLSearchParams({ fields: `id,${fields}`, limit: '1' })
      const res = await requestJson(`${GRAPH}/${encodeURIComponent(pageId)}/published_posts?${query.toString()}`, { headers })
      if (!res.ok) throw graphError(res.json, res.status)
      results.push({ permission, what, ok: true, detail: 'Facebook answered.' })
    } catch (err) {
      results.push(failure(permission, what, err))
    }
  }

  const postWhat = 'Publish a post, then delete it'
  let postId: string | null = null
  try {
    const res = await requestJson(`${GRAPH}/${encodeURIComponent(pageId)}/feed`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message: TEST_MESSAGE }).toString(),
    })
    if (!res.ok) throw graphError(res.json, res.status)
    postId = asString(asRecord(res.json).id)
    if (!postId) throw new SocialError('Facebook accepted the post but did not say which one it was.')
  } catch (err) {
    results.push(failure('pages_manage_posts', postWhat, err))
    return results
  }
  try {
    await deleteFacebookPost(token, postId)
    results.push({ permission: 'pages_manage_posts', what: postWhat, ok: true, detail: 'Published and removed again.' })
  } catch (err) {
    const why = err instanceof SocialError ? err.message : 'Facebook did not answer.'
    results.push({ permission: 'pages_manage_posts', what: postWhat, ok: false, detail: `The test post was published but could NOT be removed (${postId}). Delete it on Facebook by hand. ${why}` })
  }
  return results
}
