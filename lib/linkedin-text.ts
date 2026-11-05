import type { PostImage } from '@/modules/social-hub/lib/types'

// LinkedIn reads a post's text as "little text format": ( ) [ ] { } < > @ | _ * ~ \
// mean mentions, templates and styling, and an unescaped one quietly truncates
// the post at that point. They all have to be backslash-escaped. A # is left
// alone when it starts a hashtag (so #cactus stays a link) and escaped otherwise.

const ALWAYS_ESCAPED = /[\\|{}@[\]()<>*_~]/g

export function escapeLinkedInText(text: string): string {
  const escaped = text.replace(ALWAYS_ESCAPED, (c) => `\\${c}`)
  return escaped.replace(/#(?![A-Za-z0-9_\\])/g, '\\#')
}

/** The post's text with its link at the foot, unless the text already carries it. */
export function linkedInCommentary(body: string, linkUrl: string | null): string {
  if (!linkUrl || body.includes(linkUrl)) return body
  const text = body.trimEnd()
  return text ? `${text}\n\n${linkUrl}` : linkUrl
}

/**
 * The pictures a LinkedIn post carries: its own, or failing that the link's
 * picture, so a shared article goes out as a picture post with the address
 * in the text rather than a link card LinkedIn often shows bare.
 */
export function linkedInImages(input: { images: PostImage[]; linkImageUrl: string | null; linkTitle: string | null }): PostImage[] {
  if (input.images.length > 0) return input.images.slice(0, 4)
  if (input.linkImageUrl) return [{ url: input.linkImageUrl, alt: input.linkTitle ?? undefined }]
  return []
}
