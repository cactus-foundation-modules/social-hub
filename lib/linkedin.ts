import { absoluteUrl } from '@/modules/social-hub/lib/media-url'
import { asNumber, asRecord, asString, formBody, requestJson } from '@/modules/social-hub/lib/http'
import { escapeLinkedInText } from '@/modules/social-hub/lib/linkedin-text'
import { readCapped, safeGet } from '@/modules/social-hub/lib/safe-fetch'
import type { AppCredentials } from '@/modules/social-hub/lib/settings'
import type { LoginResult, PublishInput, PublishResult, RemotePostInput } from '@/modules/social-hub/lib/provider-types'
import { SocialError } from '@/modules/social-hub/lib/types'

/** LinkedIn versions its REST API by month and retires old ones after about a year. */
export const LI_API_VERSION = '202510'
const API = 'https://api.linkedin.com/rest'

export const LI_SCOPES = ['r_organization_social', 'w_organization_social', 'rw_organization_admin'] as const

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export function linkedInAuthUrl(creds: AppCredentials, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    state,
    scope: LI_SCOPES.join(' '),
  })
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`
}

function apiHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'linkedin-version': LI_API_VERSION,
    'x-restli-protocol-version': '2.0.0',
    ...extra,
  }
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
  const res = await requestJson(`${API}${path}`, { headers: apiHeaders(token) })
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

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; type: string }> {
  const target = absoluteUrl(url)
  const { response } = await safeGet(target)
  if (!response.ok) throw new SocialError('A picture on this post could not be downloaded.')
  const bytes = await readCapped(response, MAX_IMAGE_BYTES)
  return { bytes, type: response.headers.get('content-type') ?? 'application/octet-stream' }
}

/** Upload one picture for a page and answer its image URN. */
async function uploadImage(orgUrn: string, token: string, url: string): Promise<string> {
  const init = await requestJson(`${API}/images?action=initializeUpload`, {
    method: 'POST',
    headers: apiHeaders(token, { 'content-type': 'application/json' }),
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

export async function publishToLinkedIn(orgId: string, token: string, input: PublishInput): Promise<PublishResult> {
  const orgUrn = `urn:li:organization:${orgId}`
  const images = input.images.slice(0, 4)
  let text = input.body
  if (input.linkUrl && images.length > 0 && !text.includes(input.linkUrl)) {
    text = text ? `${text}\n\n${input.linkUrl}` : input.linkUrl
  }

  const post: Record<string, unknown> = {
    author: orgUrn,
    commentary: escapeLinkedInText(text),
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  }

  if (images.length === 1) {
    const id = await uploadImage(orgUrn, token, images[0]!.url)
    post.content = { media: { id, altText: images[0]!.alt || undefined } }
  } else if (images.length > 1) {
    const uploaded: { id: string; altText?: string }[] = []
    for (const image of images) {
      uploaded.push({ id: await uploadImage(orgUrn, token, image.url), altText: image.alt || undefined })
    }
    post.content = { multiImage: { images: uploaded } }
  } else if (input.linkUrl) {
    const article: Record<string, unknown> = {
      source: input.linkUrl,
      title: input.linkTitle || input.linkUrl,
    }
    if (input.linkDescription) article.description = input.linkDescription.slice(0, 250)
    if (input.linkImageUrl) {
      // A thumbnail is a nicety: the post should still go out without one.
      try {
        article.thumbnail = await uploadImage(orgUrn, token, input.linkImageUrl)
      } catch {
        // posted without a thumbnail
      }
    }
    post.content = { article }
  }

  const res = await requestJson(`${API}/posts`, {
    method: 'POST',
    headers: apiHeaders(token, { 'content-type': 'application/json' }),
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

async function socialCounts(urn: string, token: string): Promise<{ likes: number | null; comments: number | null }> {
  const res = await apiGet(`/socialActions/${encodeURIComponent(urn)}`, token)
  if (!res.ok) return { likes: null, comments: null }
  const body = asRecord(res.json)
  return {
    likes: asNumber(asRecord(body.likesSummary).totalLikes),
    comments: asNumber(asRecord(body.commentsSummary).aggregatedTotalComments) ??
      asNumber(asRecord(body.commentsSummary).totalFirstLevelComments),
  }
}

export async function fetchLinkedInPosts(orgId: string, token: string): Promise<RemotePostInput[]> {
  const author = encodeURIComponent(`urn:li:organization:${orgId}`)
  const res = await apiGet(`/posts?author=${author}&q=author&count=20&sortBy=LAST_MODIFIED`, token)
  if (!res.ok) throw linkedInError(res.json, res.status)
  const elements = Array.isArray(asRecord(res.json).elements) ? (asRecord(res.json).elements as unknown[]) : []
  const rows: { post: RemotePostInput; urns: string[] }[] = []
  for (const element of elements) {
    const post = parseLinkedInPost(element)
    if (post) rows.push({ post, urns: imageUrnsOf(element) })
  }

  const images = await resolveImages(rows.flatMap((r) => r.urns), token)
  const counts = await Promise.allSettled(rows.slice(0, 10).map((r) => socialCounts(r.post.externalId, token)))
  return rows.map((r, i) => {
    const c = counts[i]
    const found = c && c.status === 'fulfilled' ? c.value : null
    return {
      ...r.post,
      imageUrls: r.urns.map((u) => images.get(u)).filter((u): u is string => !!u).slice(0, 6),
      likeCount: found?.likes ?? null,
      commentCount: found?.comments ?? null,
    }
  })
}
