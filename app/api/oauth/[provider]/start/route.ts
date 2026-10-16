// GET /api/m/social-hub/oauth/:provider/start - send the signed-in admin to Facebook or LinkedIn to approve access
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { facebookAuthUrl } from '@/modules/social-hub/lib/facebook'
import { linkedInAuthUrl } from '@/modules/social-hub/lib/linkedin'
import { createState, STATE_COOKIE, STATE_TTL_SECONDS } from '@/modules/social-hub/lib/oauth-state'
import { callbackUrl, requestOrigin } from '@/modules/social-hub/lib/origin'
import { getAppCredentials } from '@/modules/social-hub/lib/settings'
import { PROVIDERS, type Provider } from '@/modules/social-hub/lib/types'

type Params = { params: Promise<{ provider: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const g = await guard('manage')
  if ('response' in g) return g.response
  const { provider } = await params
  if (!PROVIDERS.includes(provider as Provider)) return errorResponse('Unknown network', 404)
  const p = provider as Provider

  const creds = await getAppCredentials(p)
  const redirect = callbackUrl(p, requestOrigin(request.headers, request.nextUrl.origin))
  if (!creds) {
    return errorResponse('Save the app details for this network in Settings → Social Hub first.', 409)
  }

  const { state, cookie } = createState(p, g.access.userId, redirect)
  const url = p === 'facebook' ? facebookAuthUrl(creds, redirect, state) : linkedInAuthUrl(creds, redirect, state)
  const res = NextResponse.redirect(url)
  res.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: STATE_TTL_SECONDS,
  })
  return res
}
