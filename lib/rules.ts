import { z } from 'zod'
import { LIMITS, type Connection, type PostMode } from '@/modules/social-hub/lib/types'

const imageUrl = z
  .string()
  .min(1)
  .max(2000)
  .refine((v) => v.startsWith('/') || /^https?:\/\//i.test(v), 'Pictures must come from the media library or a web address.')

const optionalText = (max: number) => z.string().max(max).nullable().optional()

export const PostInput = z.object({
  body: z.string().max(LIMITS.bodyMax, `Posts can be at most ${LIMITS.bodyMax} characters.`).default(''),
  linkUrl: z.string().max(2000).url('That link is not a web address.').nullable().optional(),
  linkTitle: optionalText(300),
  linkDescription: optionalText(600),
  linkImageUrl: z.string().max(2000).url().nullable().optional(),
  images: z.array(z.object({ url: imageUrl, alt: z.string().max(400).optional() })).max(LIMITS.imagesMax).default([]),
  connectionIds: z.array(z.string().min(1).max(100)).max(20).default([]),
  mode: z.enum(['draft', 'schedule', 'now']),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
})

export type PostInputData = z.infer<typeof PostInput>

/**
 * The rules a post must meet before it can leave the building. A draft may be
 * half-finished; anything that will actually be published may not.
 * Returns a plain-English problem, or null when the post is fine.
 */
export function checkPost(input: PostInputData, connections: Connection[], now = Date.now()): string | null {
  if (input.mode === 'draft') return null

  const hasContent = input.body.trim().length > 0 || !!input.linkUrl || input.images.length > 0
  if (!hasContent) return 'Write something, add a link or add a picture first.'

  if (input.connectionIds.length === 0) return 'Choose at least one page to post to.'
  const byId = new Map(connections.map((c) => [c.id, c]))
  for (const id of input.connectionIds) {
    const conn = byId.get(id)
    if (!conn) return 'One of the chosen pages is not connected any more.'
    if (conn.status !== 'active') return `${conn.name} needs reconnecting before it can be posted to.`
  }

  if (input.mode === 'schedule') {
    if (!input.scheduledAt) return 'Pick a date and time for the post.'
    const when = Date.parse(input.scheduledAt)
    if (!Number.isFinite(when)) return 'That date and time is not valid.'
    if (when < now + LIMITS.minLeadMs) return 'Pick a time at least a minute from now.'
  }
  return null
}

export function modeLabel(mode: PostMode): string {
  return mode === 'draft' ? 'Save draft' : mode === 'schedule' ? 'Schedule' : 'Post now'
}
