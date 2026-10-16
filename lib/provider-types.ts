import type { PostImage } from '@/modules/social-hub/lib/types'

/** What a provider needs to publish. Pictures are already absolute addresses. */
export type PublishInput = {
  body: string
  linkUrl: string | null
  linkTitle: string | null
  linkDescription: string | null
  linkImageUrl: string | null
  images: PostImage[]
}

export type PublishResult = { externalId: string; permalink: string | null }

/** One post as read back from a network, ready to cache. */
export type RemotePostInput = {
  externalId: string
  message: string
  permalink: string | null
  imageUrls: string[]
  linkUrl: string | null
  linkTitle: string | null
  postedAt: Date | null
  likeCount: number | null
  commentCount: number | null
  shareCount: number | null
}

/** A read of a page: the posts, plus anything the network refused to share that the owner should be told about. */
export type RemoteRead = { posts: RemotePostInput[]; notice: string | null }

export type DiscoveredPage = {
  externalId: string
  name: string
  pictureUrl: string | null
  profileUrl: string | null
}

export type LoginResult = {
  pages: DiscoveredPage[]
  accessToken: string
  /** Facebook: each page has its own token. Absent for LinkedIn, where the member token serves every page. */
  pageTokens?: Record<string, string>
  refreshToken: string | null
  tokenExpiresAt: Date | null
  refreshExpiresAt: Date | null
  /** Permissions we asked for that the person did not end up granting. Empty for LinkedIn. */
  missingPermissions?: string[]
}
