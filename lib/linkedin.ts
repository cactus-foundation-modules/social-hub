import { absoluteUrl } from '@/modules/social-hub/lib/media-url'
import { asNumber, asRecord, asString, formBody, requestJson, type JsonResult } from '@/modules/social-hub/lib/http'
import { escapeLinkedInText, linkedInCommentary, linkedInImages } from '@/modules/social-hub/lib/linkedin-text'
import { readCapped, safeGet } from '@/modules/social-hub/lib/safe-fetch'
import type { AppCredentials } from '@/modules/social-hub/lib/settings'
import type { LoginResult, PublishInput, PublishResult, RemotePostInput, RemoteRead } from '@/modules/social-hub/lib/provider-types'
import { SocialError, type PostImage } from '@/modules/social-hub/lib/types'

const API = 'https://api.linkedin.com/rest'

// r_organization_social_feed is what LinkedIn's socialActions endpoint checks before handing over like and comment counts.
export const LI_SCOPES = ['r_organization_social', 'r_organization_social_feed', 'w_organization_social', 'rw_organization_admin'] as const
/** The older set, for apps whose Auth tab does not offer the counts permission: posting still works, the counts do not. */
export const LI_SCOPES_BASIC = ['r_organization_social', 'w_organization_social', 'rw_organization_admin'] as const

/** True when LinkedIn turned the sign-in down because the app is not allowed one of the permissions asked for. */
export function isLinkedInScopeRefusal(error: string | null): boolean {
  return error === 'unauthorized_scope_error'
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export function linkedInAuthUrl(creds: AppCredentials, redirectUri: string, state: string, basic = false): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    state,
    scope: (basic ? LI_SCOPES_BASIC : LI_SCOPES).join(' '),
  })
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`
}

/**
 * LinkedIn versions its REST API by month (YYYYMM) and retires each one after about a year,
 * and the odd month never ships at all. A fixed pin therefore breaks on its own a year later
 * ("Requested version 20251001 is not active"), so the version is worked out from today's date:
 * last month first, stepping back a month whenever LinkedIn says the one asked for is not live.
 */
export function linkedInVersionCandidates(now: Date = new Date()): string[] {
  const out: string[] = []
  for (let back = 1; back <= 10; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/** True when LinkedIn refused the request only because of the version header. */
export function isLinkedInVersionError(res: Pick<JsonResult, 'status' | 'json'>): boolean {
  if (res.status !== 400 && res.status !== 426) return false
  const body = asRecord(res.json)
  const code = asString(body.code) ?? ''
  if (code === 'NONEXISTENT_VERSION' || code === 'VERSION_MISSING') return true
  return /version .*(not active|does not exist|nonexistent)/i.test(asString(body.message) ?? '')
}

// The version that last worked in this process, so only the first request after a rollover pays for the search.
let liveVersion: string | null = null

/** One call to LinkedIn's REST API with the protocol headers, retried across versions until one is live. */
async function liRequest(path: string, token: string, init: RequestInit = {}): Promise<JsonResult> {
  const candidates = linkedInVersionCandidates()
  const order = liveVersion && candidates.includes(liveVersion)
    ? [liveVersion, ...candidates.filter((v) => v !== liveVersion)]
    : candidates
  let res: JsonResult | null = null
  for (const version of order) {
    res = await requestJson(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'linkedin-version': version,
        'x-restli-protocol-version': '2.0.0',
        ...(init.headers as Record<string, string> | undefined),
      },
    })
    if (!isLinkedInVersionError(res)) {
      liveVersion = version
      return res
    }
  }
  return res!
}

export function linkedInError(json: unknown, status: number): SocialError {
  const body = asRecord(json)
  const message = asString(body.message) ?? `LinkedIn answered with an error (${status}).`
  if (status === 401 || asNumber(body.serviceErrorCode) === 65600 || asNumber(body.serviceErrorCode) === 65601) {
    return new SocialError('LinkedIn no longer accepts this connection. Reconnect the page in Settings → Social Hub.', true)
  }
  if (status === 403) {
    return new SocialError(`LinkedIn refused: ${message} Check that your LinkedIn app has the Community Management API and that you are a super admin of the page.`)
  }
  if (status === 429) return new SocialError('LinkedIn says we are asking too often. Try again later.')
  return new SocialError(message)
}

export type LinkedInTokens = {
  accessToken: string
  refreshToken: string | null
  tokenExpiresAt: Date | null
  refreshExpiresAt: Date | null
}

function readTokens(json: unknown): LinkedInTokens | null {
  const body = asRecord(json)
  const accessToken = asString(body.access_token)
  if (!accessToken) return null
  const expires = asNumber(body.expires_in)
  const refreshExpires = asNumber(body.refresh_token_expires_in)
  return {
    accessToken,
    refreshToken: asString(body.refresh_token),
    tokenExpiresAt: expires ? new Date(Date.now() + expires * 1000) : null,
    refreshExpiresAt: refreshExpires ? new Date(Date.now() + refreshExpires * 1000) : null,
  }
}

async function tokenRequest(values: Record<string, string>): Promise<LinkedInTokens> {
  const res = await requestJson('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody(values),
  })
  const tokens = readTokens(res.json)
  if (!res.ok || !tokens) {
    const body = asRecord(res.json)
    const detail = asString(body.error_description) ?? asString(body.error) ?? `status ${res.status}`
    const invalid = asString(body.error) === 'invalid_grant' || res.status === 400
    throw new SocialError(`LinkedIn would not give us a token: ${detail}`, invalid)
  }
  return tokens
}

export function refreshLinkedInToken(creds: AppCredentials, refreshToken: string): Promise<LinkedInTokens> {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  })
}

async function apiGet(path: string, token: string): Promise<{ json: unknown; status: number; ok: boolean }> {
  const res = await liRequest(path, token)
  return { json: res.json, status: res.status, ok: res.ok }
}

export async function completeLinkedInLogin(creds: AppCredentials, redirectUri: string, code: string): Promise<LoginResult> {
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  })

  const acls = await apiGet('/organizationAcls?q=roleAssignee&state=APPROVED&count=50', tokens.accessToken)
  if (!acls.ok) throw linkedInError(acls.json, acls.status)
  const elements = Array.isArray(asRecord(acls.json).elements) ? (asRecord(acls.json).elements as unknown[]) : []
  // Roles that may publish as the page.
  const allowed = new Set(['ADMINISTRATOR', 'CONTENT_ADMIN', 'DIRECT_SPONSORED_CONTENT_POSTER'])
  const ids = new Set<string>()
  for (const element of elements) {
    const row = asRecord(element)
    const urn = asString(row.organization)
    const role = asString(row.role)
    const id = urn?.match(/^urn:li:organization:(\d+)$/)?.[1]
    if (id && (!role || allowed.has(role))) ids.add(id)
  }

  const pages: LoginResult['pages'] = []
  for (const id of ids) {
    const org = await apiGet(`/organizations/${id}`, tokens.accessToken).catch(() => null)
    const body = org?.ok ? asRecord(org.json) : {}
    const vanity = asString(body.vanityName)
    pages.push({
      externalId: id,
      name: asString(body.localizedName) ?? `LinkedIn page ${id}`,
      pictureUrl: null,
      profileUrl: `https://www.linkedin.com/company/${vanity ?? id}`,
    })
  }
  return { pages, ...tokens }
}

function permalinkFor(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}`
}

// LinkedIn's Images API takes JPG, PNG and GIF only. Anything else (the media
// library serves WebP) is accepted at upload and then never shows, so it is
// turned into a JPEG on the way out.
const LINKEDIN_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif'])

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; type: string }> {
  const target = absoluteUrl(url)
  const { response } = await safeGet(target)
  if (!response.ok) throw new SocialError('A picture on this post could not be downloaded.')
  const bytes = await readCapped(response, MAX_IMAGE_BYTES)
  const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (LINKEDIN_IMAGE_TYPES.has(type)) return { bytes, type }
  try {
    const sharp = (await import('sharp')).default
    const jpeg = await sharp(bytes, { failOn: 'none' }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
    return { bytes: new Uint8Array(jpeg), type: 'image/jpeg' }
  } catch {
    throw new SocialError('A picture on this post is in a format LinkedIn cannot show.')
  }
}

/** Upload one picture for a page and answer its image URN. */
async function uploadImage(orgUrn: string, token: string, url: string): Promise<string> {
  const init = await liRequest('/images?action=initializeUpload', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initializeUploadRequest: { owner: orgUrn } }),
  })
  if (!init.ok) throw linkedInError(init.json, init.status)
  const value = asRecord(asRecord(init.json).value)
  const uploadUrl = asString(value.uploadUrl)
  const image = asString(value.image)
  if (!uploadUrl || !image) throw new SocialError('LinkedIn would not take the picture.')

  const { bytes, type } = await fetchBytes(url)
  let put: Response
  try {
    put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': type },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new SocialError('Uploading a picture to LinkedIn failed. Try again.')
  }
  if (!put.ok) throw new SocialError(`LinkedIn rejected the picture upload (${put.status}).`)
  return image
}

async function uploadAll(orgUrn: string, token: string, images: PostImage[]): Promise<Record<string, unknown>> {
  if (images.length === 1) {
    const id = await uploadImage(orgUrn, token, images[0]!.url)
    return { media: { id, altText: images[0]!.alt || undefined } }
  }
  const uploaded: { id: string; altText?: string }[] = []
  for (const image of images) {
    uploaded.push({ id: await uploadImage(orgUrn, token, image.url), altText: image.alt || undefined })
  }
  return { multiImage: { images: uploaded } }
}

export async function publishToLinkedIn(orgId: string, token: string, input: PublishInput): Promise<PublishResult> {
  const orgUrn = `urn:li:organization:${orgId}`
  const images = linkedInImages(input)
  const text = linkedInCommentary(input.body, input.linkUrl)

  const post: Record<string, unknown> = {
    author: orgUrn,
    commentary: escapeLinkedInText(text),
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  }

  if (input.images.length > 0) {
    post.content = await uploadAll(orgUrn, token, images)
  } else if (images.length > 0) {
    // Only the link's picture: if it will not go, the post still goes out as a link card.
    try {
      post.content = await uploadAll(orgUrn, token, images)
    } catch (err) {
      if (err instanceof SocialError && err.authFailure) throw err
    }
  }
  if (!post.content && input.linkUrl) {
    const article: Record<string, unknown> = {
      source: input.linkUrl,
      title: input.linkTitle || input.linkUrl,
    }
    if (input.linkDescription) article.description = input.linkDescription.slice(0, 250)
    post.content = { article }
  }

  const res = await liRequest('/posts', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(post),
  })
  if (!res.ok) throw linkedInError(res.json, res.status)
  const urn = res.headers.get('x-restli-id') ?? res.headers.get('x-linkedin-id')
  if (!urn) throw new SocialError('LinkedIn accepted the post but did not say what it was called.')
  return { externalId: urn, permalink: permalinkFor(urn) }
}

/** LinkedIn hands text back in its escaped format: undo the escaping, flatten mentions and hashtags. */
export function readLinkedInText(raw: string): string {
  return raw
    .replace(/@\[([^\]]+)\]\(urn:li:[^)]+\)/g, '$1')
    .replace(/\{hashtag\|\\?#\|([^}]+)\}/g, '#$1')
    .replace(/\\([\\|{}@[\]()<>*_~#])/g, '$1')
}

export function parseLinkedInPost(raw: unknown): RemotePostInput | null {
  const row = asRecord(raw)
  const id = asString(row.id)
  if (!id) return null
  const state = asString(row.lifecycleState)
  if (state && state !== 'PUBLISHED') return null
  const content = asRecord(row.content)
  const article = asRecord(content.article)
  const when = asNumber(row.publishedAt) ?? asNumber(row.createdAt)
  return {
    externalId: id,
    message: readLinkedInText(asString(row.commentary) ?? ''),
    permalink: permalinkFor(id),
    imageUrls: [],
    linkUrl: asString(article.source),
    linkTitle: asString(article.title),
    postedAt: when ? new Date(when) : null,
    likeCount: null,
    commentCount: null,
    shareCount: null,
  }
}

/** The image URNs a post carries, so their addresses can be looked up in one go. */
export function imageUrnsOf(raw: unknown): string[] {
  const content = asRecord(asRecord(raw).content)
  const urns: string[] = []
  const single = asString(asRecord(content.media).id)
  if (single?.startsWith('urn:li:image:')) urns.push(single)
  const multi = asRecord(content.multiImage).images
  if (Array.isArray(multi)) {
    for (const image of multi) {
      const id = asString(asRecord(image).id)
      if (id?.startsWith('urn:li:image:')) urns.push(id)
    }
  }
  const thumb = asString(asRecord(content.article).thumbnail)
  if (thumb?.startsWith('urn:li:image:')) urns.push(thumb)
  return urns
}

async function resolveImages(urns: string[], token: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(urns)].slice(0, 40)
  if (unique.length === 0) return out
  const list = `List(${unique.map((u) => encodeURIComponent(u)).join(',')})`
  const res = await apiGet(`/images?ids=${list}`, token).catch(() => null)
  if (!res?.ok) return out
  const results = asRecord(asRecord(res.json).results)
  for (const [urn, value] of Object.entries(results)) {
    const url = asString(asRecord(value).downloadUrl)
    if (url) out.set(urn, url)
  }
  return out
}

export type SocialCounts =
  | { ok: true; likes: number; comments: number }
  | { ok: false; status: number; reason: string | null }

/**
 * Reads one socialActions summary. LinkedIn leaves likesSummary or commentsSummary out entirely
 * (and answers {} for a post nobody has touched) when there is nothing to count, so a missing
 * summary on a successful answer is a zero, not a refusal.
 */
export function readSocialCounts(res: Pick<JsonResult, 'ok' | 'status' | 'json'>): SocialCounts {
  const body = asRecord(res.json)
  if (!res.ok) return { ok: false, status: res.status, reason: asString(body.message) }
  const likes = asRecord(body.likesSummary)
  const comments = asRecord(body.commentsSummary)
  return {
    ok: true,
    likes: asNumber(likes.totalLikes) ?? asNumber(likes.aggregatedTotalLikes) ?? 0,
    comments: asNumber(comments.aggregatedTotalComments) ?? asNumber(comments.totalFirstLevelComments) ?? 0,
  }
}

async function socialCounts(urn: string, token: string): Promise<SocialCounts> {
  return readSocialCounts(await apiGet(`/socialActions/${encodeURIComponent(urn)}`, token))
}

/** The read notice for the counts, or null when at least one post's counts came back. */
export function countsNotice(results: (SocialCounts | null)[]): string | null {
  if (results.length === 0 || results.some((r) => r?.ok)) return null
  const refused = results.find((r): r is Extract<SocialCounts, { ok: false }> => !!r && !r.ok)
  const said = refused?.reason ? ` LinkedIn said: ${refused.reason}` : ''
  if (refused && (refused.status === 401 || refused.status === 403)) {
    return `LinkedIn would not share like and comment counts.${said} Reconnect this page so LinkedIn can ask for the counts permission; if it still refuses, open your app on LinkedIn's developer site, check the Auth tab lists r_organization_social_feed, then reconnect.`
  }
  return `LinkedIn would not share like and comment counts.${said || ' It did not say why.'} They will be tried again on the next read.`
}

/** Take a post off the page. 'gone' when LinkedIn says it no longer exists. */
export async function deleteLinkedInPost(token: string, urn: string): Promise<'deleted' | 'gone'> {
  const res = await liRequest(`/posts/${encodeURIComponent(urn)}`, token, {
    method: 'DELETE',
    headers: { 'x-restli-method': 'DELETE' },
  })
  if (res.ok) return 'deleted'
  if (res.status === 404) return 'gone'
  throw linkedInError(res.json, res.status)
}

const LINKEDIN_PAGE = 20
const LINKEDIN_PAGES_MAX = 5

/** The most posts one read of a LinkedIn page returns; fewer than this means the whole page was read. */
export const LINKEDIN_READ_CAP = LINKEDIN_PAGE * LINKEDIN_PAGES_MAX

export async function fetchLinkedInPosts(orgId: string, token: string): Promise<RemoteRead> {
  const author = encodeURIComponent(`urn:li:organization:${orgId}`)
  const elements: unknown[] = []
  let stoppedEarly: string | null = null
  for (let page = 0; page < LINKEDIN_PAGES_MAX; page++) {
    const res = await apiGet(`/posts?author=${author}&q=author&count=${LINKEDIN_PAGE}&start=${page * LINKEDIN_PAGE}&sortBy=LAST_MODIFIED`, token)
    if (!res.ok) {
      // The first page failing is the real error; a later one failing just ends the read.
      if (page === 0) throw linkedInError(res.json, res.status)
      stoppedEarly = linkedInError(res.json, res.status).message
      break
    }
    const got = Array.isArray(asRecord(res.json).elements) ? (asRecord(res.json).elements as unknown[]) : []
    elements.push(...got)
    if (got.length < LINKEDIN_PAGE) break
  }
  const rows: { post: RemotePostInput; urns: string[] }[] = []
  for (const element of elements) {
    const post = parseLinkedInPost(element)
    if (post) rows.push({ post, urns: imageUrnsOf(element) })
  }

  const images = await resolveImages(rows.flatMap((r) => r.urns), token)
  const settled = await Promise.allSettled(rows.slice(0, 10).map((r) => socialCounts(r.post.externalId, token)))
  const counts = settled.map((c) => (c.status === 'fulfilled' ? c.value : null))
  const posts = rows.map((r, i) => {
    const found = counts[i]
    return {
      ...r.post,
      imageUrls: r.urns.map((u) => images.get(u)).filter((u): u is string => !!u).slice(0, 6),
      likeCount: found?.ok ? found.likes : null,
      commentCount: found?.ok ? found.comments : null,
    }
  })
  const parts: string[] = []
  // The counts are asked for the ten newest posts; only every one of those failing counts as LinkedIn refusing.
  const notice = countsNotice(counts)
  if (notice) parts.push(notice)
  if (stoppedEarly) parts.push(`Older posts could not be read: ${stoppedEarly}`)
  return { posts, notice: parts.length ? parts.join(' ') : null }
}
