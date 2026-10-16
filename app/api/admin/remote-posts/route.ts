// DELETE /api/m/social-hub/admin/remote-posts { connectionId, externalId } - delete a post from its Facebook or LinkedIn page
// PATCH  /api/m/social-hub/admin/remote-posts { connectionId, externalId, message } - rewrite the text of a Facebook post
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { deleteRemotePost } from '@/modules/social-hub/lib/remote-delete'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import { editRemotePost } from '@/modules/social-hub/lib/remote-edit'
import { LIMITS, SocialError } from '@/modules/social-hub/lib/types'

export const maxDuration = 30

const Body = z.object({ connectionId: z.string().min(1).max(100), externalId: z.string().min(1).max(300) })

const EditBody = Body.extend({ message: z.string().max(LIMITS.bodyMax + 500) })

export async function PATCH(request: NextRequest) {
  const g = await guard('post')
  if ('response' in g) return g.response
  const parsed = EditBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('Invalid request', 400)
  try {
    await editRemotePost(parsed.data.connectionId, parsed.data.externalId, parsed.data.message)
    await syncAttentionAlert()
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof SocialError) return errorResponse(err.message, err.authFailure ? 409 : 502)
    return errorResponse('Editing the post failed unexpectedly.', 500)
  }
}

export async function DELETE(request: NextRequest) {
  const g = await guard('post')
  if ('response' in g) return g.response
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('Invalid request', 400)
  try {
    const result = await deleteRemotePost(parsed.data.connectionId, parsed.data.externalId)
    await syncAttentionAlert()
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof SocialError) return errorResponse(err.message, err.authFailure ? 409 : 502)
    return errorResponse('Deleting the post failed unexpectedly.', 500)
  }
}
