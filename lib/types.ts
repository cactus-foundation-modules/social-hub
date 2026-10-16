// Shared shapes. No server-only imports in here: the admin screens use these
// too, and anything pulled in would end up in the browser bundle.

export const PROVIDERS = ['facebook', 'linkedin'] as const
export type Provider = (typeof PROVIDERS)[number]

export const PROVIDER_LABEL: Record<Provider, string> = {
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
}

export type ConnectionStatus = 'active' | 'needs_reauth'

export type Connection = {
  id: string
  provider: Provider
  externalId: string
  name: string
  pictureUrl: string | null
  profileUrl: string | null
  status: ConnectionStatus
  lastError: string | null
  lastSyncedAt: string | null
  tokenExpiresAt: string | null
  createdAt: string
}

export type PostImage = { url: string; alt?: string }

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed'
export type TargetStatus = 'pending' | 'publishing' | 'published' | 'failed'

export type PostTarget = {
  id: string
  connectionId: string
  provider: Provider
  connectionName: string
  status: TargetStatus
  externalId: string | null
  permalink: string | null
  error: string | null
}

export type Post = {
  id: string
  body: string
  linkUrl: string | null
  linkTitle: string | null
  linkDescription: string | null
  linkImageUrl: string | null
  images: PostImage[]
  status: PostStatus
  scheduledAt: string | null
  publishedAt: string | null
  createdAt: string
  targets: PostTarget[]
}

export type RemotePost = {
  connectionId: string
  provider: Provider
  connectionName: string
  externalId: string
  message: string
  permalink: string | null
  imageUrls: string[]
  linkUrl: string | null
  linkTitle: string | null
  postedAt: string | null
  likeCount: number | null
  commentCount: number | null
  shareCount: number | null
  viaSocialHub: boolean
}

export type LinkPreview = {
  url: string
  title: string | null
  description: string | null
  imageUrl: string | null
  siteName: string | null
}

export type PostMode = 'draft' | 'schedule' | 'now'

/** Hard limits the networks enforce, kept in one place so screen and server agree. */
export const LIMITS = {
  /** LinkedIn's commentary cap; Facebook allows far more, so this is the binding one. */
  bodyMax: 3000,
  imagesMax: 4,
  /** The soonest a post may be scheduled, so a clock a minute out of step cannot make it "in the past". */
  minLeadMs: 60_000,
} as const

/** Ones the screen can say plainly rather than showing a status code. */
export class SocialError extends Error {
  /** True when the network refused our credentials, so the page should be reconnected. */
  authFailure: boolean
  constructor(message: string, authFailure = false) {
    super(message)
    this.name = 'SocialError'
    this.authFailure = authFailure
  }
}
