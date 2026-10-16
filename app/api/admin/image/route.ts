// GET /api/m/social-hub/admin/image?u=<address> - a remote picture, passed through for the admin screens.
// The site's content security policy allows no third-party image hosts, and widening it for every
// visitor to preview a picture in the admin would be the wrong trade, so the server fetches it instead.
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { readCapped, safeGet } from '@/modules/social-hub/lib/safe-fetch'
import { SocialError } from '@/modules/social-hub/lib/types'

const MAX_BYTES = 6 * 1024 * 1024
const ALLOWED = /^image\/(jpeg|png|gif|webp|avif)$/i

export async function GET(request: NextRequest) {
  const g = await guard('view')
  if ('response' in g) return g.response
  const target = request.nextUrl.searchParams.get('u')
  if (!target) return errorResponse('Missing address', 400)
  try {
    const { response } = await safeGet(target, { accept: 'image/*' })
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
    if (!response.ok || !ALLOWED.test(type)) return errorResponse('Not a picture', 422)
    const bytes = await readCapped(response, MAX_BYTES)
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'content-type': type,
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        // Whatever the picture is, it must never run as a page.
        'content-security-policy': "default-src 'none'; sandbox",
      },
    })
  } catch (err) {
    return errorResponse(err instanceof SocialError ? err.message : 'Could not load that picture.', 422)
  }
}
