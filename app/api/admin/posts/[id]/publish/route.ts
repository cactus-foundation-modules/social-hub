// POST /api/m/social-hub/admin/posts/:id/publish - post now, or retry the pages that failed
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { getPost } from '@/modules/social-hub/lib/posts'
import { publishPostNow } from '@/modules/social-hub/lib/publish'

export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, { params }: Params) {
  const g = await guard('post')
  if ('response' in g) return g.response
  const { id } = await params
  const outcome = await publishPostNow(id)
  if (!outcome.ok) {
    return errorResponse(
      outcome.reason === 'missing' ? 'That post is not here any more.' : 'That post is already going out, or has gone out.',
      outcome.reason === 'missing' ? 404 : 409,
    )
  }
  return NextResponse.json({ post: await getPost(id), outcome })
}
