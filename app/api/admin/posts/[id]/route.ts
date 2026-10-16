// GET/PATCH/DELETE /api/m/social-hub/admin/posts/:id
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import { listConnections } from '@/modules/social-hub/lib/connections'
import { deletePost, getPost, updatePost } from '@/modules/social-hub/lib/posts'
import { publishPostNow } from '@/modules/social-hub/lib/publish'
import { checkPost, PostInput } from '@/modules/social-hub/lib/rules'

export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

const EDITABLE = new Set(['draft', 'scheduled', 'failed'])

export async function GET(_request: NextRequest, { params }: Params) {
  const g = await guard('view')
  if ('response' in g) return g.response
  const post = await getPost((await params).id)
  if (!post) return errorResponse('That post is not here any more.', 404)
  return NextResponse.json({ post })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const g = await guard('post')
  if ('response' in g) return g.response
  const { id } = await params
  const existing = await getPost(id)
  if (!existing) return errorResponse('That post is not here any more.', 404)
  if (!EDITABLE.has(existing.status)) {
    return errorResponse('This post has already gone out, or is going out now, so it cannot be edited.', 409)
  }
  const parsed = PostInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'That post is not valid.', 400)
  const problem = checkPost(parsed.data, await listConnections())
  if (problem) return errorResponse(problem, 422)

  await updatePost(id, parsed.data)
  if (parsed.data.mode === 'now') {
    const outcome = await publishPostNow(id)
    return NextResponse.json({ post: await getPost(id), outcome })
  }
  await syncAttentionAlert()
  return NextResponse.json({ post: await getPost(id) })
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const g = await guard('post')
  if ('response' in g) return g.response
  const { id } = await params
  if (!(await deletePost(id))) return errorResponse('That post is going out right now, or is already gone.', 409)
  await syncAttentionAlert()
  return NextResponse.json({ ok: true })
}
