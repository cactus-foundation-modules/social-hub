import { absoluteUrl } from '@/modules/social-hub/lib/media-url'
import { asNumber, asRecord, asString, formBody, requestJson } from '@/modules/social-hub/lib/http'
import type { AppCredentials } from '@/modules/social-hub/lib/settings'
import type { LoginResult, PublishInput, PublishResult, RemotePostInput, RemoteRead } from '@/modules/social-hub/lib/provider-types'
import { SocialError } from '@/modules/social-hub/lib/types'

export const FB_GRAPH_VERSION = 'v24.0'
const GRAPH = `https://graph.facebook.com/${FB_GRAPH_VERSION}`

/** What we ask Facebook for. Publishing needs the first three; reading likes and comments needs engagement. */
export const FB_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'] as const

export function facebookAuthUrl(creds: AppCredentials, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
  })
  if (creds.configId) {
    // "Facebook Login for Business" apps take a saved configuration instead of a permission list.
    params.set('config_id', creds.configId)
    params.set('override_default_response_type', 'true')
  } else {
    params.set('scope', FB_SCOPES.join(','))
  }
  return `https://www.facebook.com/${FB_GRAPH_VERSION}/dialog/oauth?${params.toString()}`
}

/** Turn a Graph API error body into a sentence a site owner can act on. */
export function graphError(json: unknown, status: number): SocialError {
  const err = asRecord(asRecord(json).error)
  const code = asNumber(err.code)
  const message = asString(err.message) ?? `Facebook answered with an error (${status}).`
  // 190: token invalid or expired. 102: session gone. 459/460/463/467: the user must log in again.
  const auth = code === 190 || code === 102 || code === 459 || code === 460 || code === 463 || code === 467
  if (auth) {
    return new SocialError('Facebook no longer accepts this connection. Reconnect the page in Settings → Social Hub.', true, code)
  }
  if (code === 200 || code === 10 || (code !== null && code >= 200 && code < 300)) {
    return new SocialError(`Facebook says this connection is missing a permission: ${message}`, false, code)
  }
  return new SocialError(message, false, code)
}

async function graphGet(path: string, token: string, query: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const url = `${GRAPH}${path}?${new URLSearchParams(query).toString()}`
  const res = await requestJson(url, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw graphError(res.json, res.status)
  return asRecord(res.json)
}

async function graphPost(path: string, token: string, values: Record<string, string | undefined>): Promise<Record<string, unknown>> {
  const res = await requestJson(`${GRAPH}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody(values),
  })
  if (!res.ok) throw graphError(res.json, res.status)
  return asRecord(res.json)
}

/** Which of the permissions we need are absent from a /me/permissions answer. */
export function missingFacebookPermissions(body: unknown): string[] {
  const rows = Array.isArray(asRecord(body).data) ? (asRecord(body).data as unknown[]) : []
  const granted = new Set<string>()
  for (const row of rows) {
    const r = asRecord(row)
    const name = asString(r.permission)
    if (name && asString(r.status) === 'granted') granted.add(name)
  }
  return FB_SCOPES.filter((scope) => !granted.has(scope))
}

export async function completeFacebookLogin(creds: AppCredentials, redirectUri: string, code: string): Promise<LoginResult> {
  const short = await requestJson(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      code,
    }).toString()}`,
  )
  const shortToken = asString(asRecord(short.json).access_token)
  if (!short.ok || !shortToken) throw graphError(short.json, short.status)

  // A page token taken from a long-lived user token does not expire.
  const long = await requestJson(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      fb_exchange_token: shortToken,
    }).toString()}`,
  )
  const longToken = asString(asRecord(long.json).access_token) ?? shortToken

  const accounts = await graphGet('/me/accounts', longToken, {
    fields: 'id,name,access_token,link,picture.type(large){url}',
    limit: '100',
  })
  const data = Array.isArray(accounts.data) ? accounts.data : []
  const pages: LoginResult['pages'] = []
  const pageTokens: Record<string, string> = {}
  for (const entry of data) {
    const row = asRecord(entry)
    const id = asString(row.id)
    const token = asString(row.access_token)
    if (!id || !token) continue
    pages.push({
      externalId: id,
      name: asString(row.name) ?? `Facebook page ${id}`,
      pictureUrl: asString(asRecord(asRecord(row.picture).data).url),
      profileUrl: asString(row.link) ?? `https://www.facebook.com/${id}`,
    })
    pageTokens[id] = token
  }
  // A "Facebook Login for Business" app ignores the permission list we send and grants only what its
  // saved configuration holds, so a sign-in can succeed yet carry no right to post or read. Ask what
  // was really granted rather than finding out on the first post.
  const permissions = await graphGet('/me/permissions', longToken).catch(() => null)
  const missingPermissions = permissions ? missingFacebookPermissions(permissions) : []
  return { pages, pageTokens, accessToken: longToken, refreshToken: null, tokenExpiresAt: null, refreshExpiresAt: null, missingPermissions }
}

function messageWithLink(input: PublishInput): string {
  // With pictures there is no room for a link card, so the address goes in the text.
  if (input.linkUrl && input.images.length > 0 && !input.body.includes(input.linkUrl)) {
    return input.body ? `${input.body}\n\n${input.linkUrl}` : input.linkUrl
  }
  return input.body
}

export async function publishToFacebook(pageId: string, token: string, input: PublishInput): Promise<PublishResult> {
  const message = messageWithLink(input)
  const images = input.images.slice(0, 4)
  let created: Record<string, unknown>

  if (images.length === 0) {
    created = await graphPost(`/${pageId}/feed`, token, {
      message: message || undefined,
      link: input.linkUrl ?? undefined,
    })
  } else if (images.length === 1) {
    created = await graphPost(`/${pageId}/photos`, token, {
      url: absoluteUrl(images[0]!.url),
      caption: message || undefined,
      published: 'true',
    })
  } else {
    const ids: string[] = []
    for (const image of images) {
      const photo = await graphPost(`/${pageId}/photos`, token, {
        url: absoluteUrl(image.url),
        published: 'false',
        temporary: 'true',
      })
      const id = asString(photo.id)
      if (!id) throw new SocialError('Facebook did not accept one of the pictures.')
      ids.push(id)
    }
    created = await graphPost(`/${pageId}/feed`, token, {
      message: message || undefined,
      attached_media: JSON.stringify(ids.map((id) => ({ media_fbid: id }))),
    })
  }

  const externalId = asString(created.post_id) ?? asString(created.id)
  if (!externalId) throw new SocialError('Facebook accepted the post but did not say what it was called.')
  let permalink: string | null = null
  try {
    const look = await graphGet(`/${externalId}`, token, { fields: 'permalink_url' })
    const raw = asString(look.permalink_url)
    permalink = raw ? (raw.startsWith('http') ? raw : `https://www.facebook.com${raw}`) : null
  } catch {
    permalink = null
  }
  return { externalId, permalink }
}

const ATTACHMENT_FIELDS = 'attachments{media_type,type,url,title,media{image{src}},subattachments{media{image{src}}}}'

/**
 * What to ask for, richest first. A token can be allowed the posts and refused the
 * extras (counts, attachments), and the extras differ in what they need, so each step
 * drops the most demanding thing still left. `link` is a plain field and is what tells
 * us which web address a picture post was sharing, which is how a blog post is
 * recognised on the page - so it is kept in every step but the last resort.
 */
const FIELD_STEPS = [
  ['id', 'message', 'created_time', 'permalink_url', 'full_picture', 'shares', 'link', ATTACHMENT_FIELDS, 'likes.limit(0).summary(true)', 'comments.limit(0).summary(true)'].join(','),
  ['id', 'message', 'created_time', 'permalink_url', 'full_picture', 'link', ATTACHMENT_FIELDS].join(','),
  'id,message,created_time,permalink_url,full_picture,link',
  'id,message,created_time,permalink_url,full_picture',
]

/** A picture post's `link` can be its own photo page on Facebook; only an address elsewhere says what was shared. */
function externalLink(link: string | null): string | null {
  if (!link) return null
  try {
    const host = new URL(link).hostname.toLowerCase()
    return host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host === 'fb.me' ? null : link
  } catch {
    return null
  }
}

export function parseFacebookPost(raw: unknown): RemotePostInput | null {
  const row = asRecord(raw)
  const id = asString(row.id)
  if (!id) return null
  const attachment = asRecord(Array.isArray(asRecord(row.attachments).data) ? (asRecord(row.attachments).data as unknown[])[0] : null)
  const subs = Array.isArray(asRecord(attachment.subattachments).data) ? (asRecord(attachment.subattachments).data as unknown[]) : []
  const images: string[] = []
  for (const sub of subs) {
    const src = asString(asRecord(asRecord(asRecord(sub).media).image).src)
    if (src) images.push(src)
  }
  if (images.length === 0) {
    const single = asString(row.full_picture) ?? asString(asRecord(asRecord(attachment.media).image).src)
    if (single) images.push(single)
  }
  const isLink = asString(attachment.type) === 'share' || asString(attachment.media_type) === 'link'
  const created = asString(row.created_time)
  const rawLink = asString(row.permalink_url)
  return {
    externalId: id,
    message: asString(row.message) ?? '',
    permalink: rawLink ? (rawLink.startsWith('http') ? rawLink : `https://www.facebook.com${rawLink}`) : null,
    imageUrls: images.slice(0, 6),
    linkUrl: isLink ? asString(attachment.url) : externalLink(asString(row.link)),
    linkTitle: isLink ? asString(attachment.title) : null,
    postedAt: created ? new Date(created) : null,
    likeCount: asNumber(asRecord(asRecord(row.likes).summary).total_count),
    commentCount: asNumber(asRecord(asRecord(row.comments).summary).total_count),
    shareCount: asNumber(asRecord(row.shares).count),
  }
}

export function isPermissionError(err: unknown): boolean {
  return err instanceof SocialError && !err.authFailure && err.code !== null && (err.code === 10 || (err.code >= 200 && err.code < 300))
}

/**
 * Take a post off the Page. Answers 'gone' when Facebook says it was already deleted
 * (someone removed it on Facebook itself), which is the outcome the caller wanted anyway.
 */
export async function deleteFacebookPost(token: string, externalId: string): Promise<'deleted' | 'gone'> {
  const res = await requestJson(`${GRAPH}/${encodeURIComponent(externalId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  })
  if (res.ok && asRecord(res.json).success !== false) return 'deleted'
  const err = asRecord(asRecord(res.json).error)
  // 100 with subcode 33: the object does not exist (or is not visible to this token any more).
  if (res.status === 404 || (asNumber(err.code) === 100 && asNumber(err.error_subcode) === 33)) return 'gone'
  throw graphError(res.json, res.status)
}

const FACEBOOK_PAGE = 25
const FACEBOOK_PAGES_MAX = 8

/** The most posts one read of a Facebook page returns; fewer than this means the whole page was read. */
export const FACEBOOK_READ_CAP = FACEBOOK_PAGE * FACEBOOK_PAGES_MAX

/** What each step down from the richest request costs the owner, said in their terms. */
const STEP_LOSS = [
  null,
  'like, comment and share counts',
  'like, comment and share counts, and the details of any link a post shares',
  'like, comment and share counts, the details of link posts, and the address a post links to (so Gazette posts cannot be matched to it)',
]

function readNotice(step: number, reason: string | null, stoppedEarly: string | null): string | null {
  const parts: string[] = []
  const loss = STEP_LOSS[step]
  if (loss) {
    parts.push(
      `Facebook would not share ${loss}.${reason ? ` Facebook said: ${reason}` : ''} Reconnect this page and tick every permission Facebook offers; if that does not help, check the app's permissions (pages_read_engagement) on Facebook's developer site.`,
    )
  }
  if (stoppedEarly) parts.push(`Older posts could not be read: ${stoppedEarly}`)
  return parts.length ? parts.join(' ') : null
}

export async function fetchFacebookPosts(pageId: string, token: string): Promise<RemoteRead> {
  const posts: RemotePostInput[] = []
  let step = 0
  let used = 0
  let reason: string | null = null
  let stoppedEarly: string | null = null
  let after: string | undefined
  for (let page = 0; page < FACEBOOK_PAGES_MAX; page++) {
    let res: Record<string, unknown> | null = null
    let lastError: unknown = null
    // Only the first page looks for the richest request this token is allowed; later pages
    // must use the same one, or one read would mix posts with and without their links.
    const last = page === 0 ? FIELD_STEPS.length - 1 : step
    for (; step <= last; step++) {
      try {
        res = await graphGet(`/${pageId}/published_posts`, token, {
          fields: FIELD_STEPS[step]!,
          limit: String(FACEBOOK_PAGE),
          ...(after ? { after } : {}),
        })
        used = step
        break
      } catch (err) {
        // A refusal of the extras steps down; a sign-in problem or anything else stands.
        if (!(err instanceof SocialError) || err.authFailure) throw err
        lastError = err
        if (page === 0 && step === 0) reason = err.message
      }
    }
    if (!res) {
      // Nothing worked on the first page: that is the real error. Later on, keep what was read.
      if (page === 0) throw lastError
      stoppedEarly = lastError instanceof SocialError ? lastError.message : 'Facebook stopped answering.'
      break
    }
    const rows = Array.isArray(res.data) ? res.data : []
    posts.push(...rows.map(parseFacebookPost).filter((p): p is RemotePostInput => p !== null))
    after = asString(asRecord(asRecord(res.paging).cursors).after) ?? undefined
    if (rows.length < FACEBOOK_PAGE || !asString(asRecord(res.paging).next) || !after) break
  }
  return { posts, notice: readNotice(used, reason, stoppedEarly) }
}

/** Plain-English summary of Facebook's debug_token answer: what this token can really do. */
export function formatTokenReport(body: unknown): string {
  const data = asRecord(asRecord(body).data)
  if (Object.keys(data).length === 0) return 'Facebook would not describe this token.'
  const scopes = Array.isArray(data.scopes) ? data.scopes.filter((s): s is string => typeof s === 'string') : []
  const granular = Array.isArray(data.granular_scopes) ? data.granular_scopes : []
  const parts: string[] = [`token type ${asString(data.type) ?? 'unknown'}`, data.is_valid === false ? 'NOT valid' : 'valid']
  parts.push(`scopes: ${scopes.length ? scopes.join(', ') : 'none'}`)
  const per = granular
    .map((g) => {
      const row = asRecord(g)
      const ids = Array.isArray(row.target_ids) ? row.target_ids.length : 0
      return `${asString(row.scope) ?? '?'}${ids ? ` (${ids} page${ids === 1 ? '' : 's'})` : ''}`
    })
    .join(', ')
  if (per) parts.push(`per-page: ${per}`)
  return parts.join('; ')
}

/** Ask Facebook what a stored token can do. Never throws; answers a sentence either way. */
export async function describeFacebookToken(creds: AppCredentials, token: string): Promise<string> {
  try {
    const res = await requestJson(
      `${GRAPH}/debug_token?${new URLSearchParams({ input_token: token, access_token: `${creds.clientId}|${creds.clientSecret}` }).toString()}`,
    )
    return res.ok ? formatTokenReport(res.json) : 'Facebook would not describe this token.'
  } catch {
    return 'Facebook would not describe this token.'
  }
}
