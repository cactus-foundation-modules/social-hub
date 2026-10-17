// GET /api/m/social-hub/admin/gazette-share/:articleId - pages, and the social post that follows this article
// PUT /api/m/social-hub/admin/gazette-share/:articleId - tick pages, write the text, pick the time; post now when asked
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import { listConnections } from '@/modules/social-hub/lib/connections'
import { linkedPost, saveLinked, UNSENT } from '@/modules/social-hub/lib/gazette-follow'
import { publishPostNow } from '@/modules/social-hub/lib/publish'
import { LIMITS } from '@/modules/social-hub/lib/types'

export const maxDuration = 60

type Params = { params: Promise<{ articleId: string }> }

const iso = z.string().datetime({ offset: true })

const Body = z.object({
  article: z.object({
    title: z.string().max(500),
    excerpt: z.string().max(2000).nullable(),
    url: z.string().min(1).max(2000),
    imageUrl: z.string().max(2000).nullable(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'SCHEDULED']),
    liveAt: iso.nullable(),
    isPrivate: z.boolean(),
  }),
  body: z.string().max(LIMITS.bodyMax, `Social posts can be at most ${LIMITS.bodyMax} characters.`),
  connectionIds: z.array(z.string().min(1).max(100)).max(20),
  sourceAt: iso.nullable(),
  go: z.boolean().default(false),
})

export async function GET(_request: NextRequest, { params }: Params) {
  const g = await guard('view')
  if ('response' in g) return g.response
  const { articleId } = await params
  const [connections, post] = await Promise.all([listConnections(), linkedPost(articleId)])
  return NextResponse.json({ connections, post, canPost: g.access.canPost })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const g = await guard('post')
  if ('response' in g) return g.response
  const { articleId } = await params
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'That social post is not valid.', 400)
  const input = parsed.data

  const existing = await linkedPost(articleId)
  if (existing && !(UNSENT as readonly string[]).includes(existing.status)) {
    return errorResponse('The social post for this article has already gone out, so it cannot be changed here.', 409)
  }

  if (input.connectionIds.length > 0) {
    const byId = new Map((await listConnections()).map((c) => [c.id, c]))
    for (const id of input.connectionIds) {
      const conn = byId.get(id)
      if (!conn) return errorResponse('One of the ticked pages is not connected any more.', 422)
      if (conn.status !== 'active') return errorResponse(`${conn.name} needs reconnecting in Social Hub before it can be posted to.`, 422)
    }
    if (input.go && (input.article.isPrivate || input.article.status !== 'PUBLISHED')) {
      return errorResponse('Only a public, published article can be shared.', 422)
    }
  }

  const saved = await saveLinked({ ...input, article: { id: articleId, ...input.article } }, g.access.userId)
  if (saved.id && input.go && saved.dueNow) await publishPostNow(saved.id)
  await syncAttentionAlert()
  return NextResponse.json({ post: await linkedPost(articleId) })
}
