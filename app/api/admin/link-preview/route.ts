// POST /api/m/social-hub/admin/link-preview { url } - title, description and picture for a web address
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { fetchLinkPreview } from '@/modules/social-hub/lib/link-preview'
import { SocialError } from '@/modules/social-hub/lib/types'

const Body = z.object({ url: z.string().url().max(2000) })

export async function POST(request: NextRequest) {
  const g = await guard('post')
  if ('response' in g) return g.response
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('That is not a web address.', 400)
  try {
    return NextResponse.json({ preview: await fetchLinkPreview(parsed.data.url) })
  } catch (err) {
    return errorResponse(err instanceof SocialError ? err.message : 'Could not read that page.', 422)
  }
}
