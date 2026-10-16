import { absoluteUrl } from '@/modules/social-hub/lib/media-url'
import { asNumber, asRecord, asString, formBody, requestJson } from '@/modules/social-hub/lib/http'
import type { AppCredentials } from '@/modules/social-hub/lib/settings'
import type { LoginResult, PublishInput, PublishResult, RemotePostInput } from '@/modules/social-hub/lib/provider-types'
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

const POST_FIELDS = [
  'id', 'message', 'created_time', 'permalink_url', 'full_picture', 'shares',
  'attachments{media_type,type,url,title,media{image{src}},subattachments{media{image{src}}}}',
  'likes.limit(0).summary(true)', 'comments.limit(0).summary(true)',
].join(',')

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
    linkUrl: isLink ? asString(attachment.url) : null,
    linkTitle: isLink ? asString(attachment.title) : null,
    postedAt: created ? new Date(created) : null,
    likeCount: asNumber(asRecord(asRecord(row.likes).summary).total_count),
    commentCount: asNumber(asRecord(asRecord(row.comments).summary).total_count),
    shareCount: asNumber(asRecord(row.shares).count),
  }
}

/** Just the post itself: no counts, no attachments. Needs the least from the token. */
const BASIC_POST_FIELDS = 'id,message,created_time,permalink_url,full_picture'

export function isPermissionError(err: unknown): boolean {
  return err instanceof SocialError && !err.authFailure && err.code !== null && (err.code === 10 || (err.code >= 200 && err.code < 300))
}

export async function fetchFacebookPosts(pageId: string, token: string): Promise<RemotePostInput[]> {
  let res: Record<string, unknown>
  try {
    res = await graphGet(`/${pageId}/published_posts`, token, { fields: POST_FIELDS, limit: '25' })
  } catch (err) {
    // The extras (likes, comments, attachments) can need more than the bare posts do. Show the posts
    // without them rather than nothing at all; if even that is refused the original error stands.
    if (!isPermissionError(err)) throw err
    try {
      res = await graphGet(`/${pageId}/published_posts`, token, { fields: BASIC_POST_FIELDS, limit: '25' })
    } catch {
      throw err
    }
  }
  const rows = Array.isArray(res.data) ? res.data : []
  return rows.map(parseFacebookPost).filter((p): p is RemotePostInput => p !== null)
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
