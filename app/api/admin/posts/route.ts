// GET  /api/m/social-hub/admin/posts?view=scheduled|drafts|issues
// POST /api/m/social-hub/admin/posts - save a draft, schedule a post, or post it now
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import { listConnections } from '@/modules/social-hub/lib/connections'
import { createPost, getPost, listPosts } from '@/modules/social-hub/lib/posts'
import { publishPostNow } from '@/modules/social-hub/lib/publish'
import { checkPost, PostInput } from '@/modules/social-hub/lib/rules'
import type { PostStatus } from '@/modules/social-hub/lib/types'

export const maxDuration = 60

const VIEWS: Record<string, PostStatus[]> = {
  scheduled: ['scheduled', 'publishing'],
  drafts: ['draft'],
  issues: ['failed', 'partial'],
}

export async function GET(request: NextRequest) {
  const g = await guard('view')
  if ('response' in g) return g.response
  const statuses = VIEWS[request.nextUrl.searchParams.get('view') ?? 'scheduled']
  if (!statuses) return errorResponse('Unknown view', 400)
  return NextResponse.json({ posts: await listPosts(statuses) })
}

export async function POST(request: NextRequest) {
  const g = await guard('post')
  if ('response' in g) return g.response
  const parsed = PostInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'That post is not valid.', 400)

  const problem = checkPost(parsed.data, await listConnections())
  if (problem) return errorResponse(problem, 422)

  const id = await createPost(parsed.data, g.access.userId)
  if (parsed.data.mode === 'now') {
    const outcome = await publishPostNow(id)
    const post = await getPost(id)
    return NextResponse.json({ post, outcome })
  }
  await syncAttentionAlert()
  return NextResponse.json({ post: await getPost(id) })
}
