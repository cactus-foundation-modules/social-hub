// GET /api/m/social-hub/oauth/:provider/callback - where Facebook or LinkedIn sends the admin back
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getSiteUrlOrNull } from '@/lib/config/env'
import { guard } from '@/modules/social-hub/lib/api'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import { completeConnection } from '@/modules/social-hub/lib/connect'
import { STATE_COOKIE, readState } from '@/modules/social-hub/lib/oauth-state'
import { isLinkedInScopeRefusal } from '@/modules/social-hub/lib/linkedin'
import { syncAll } from '@/modules/social-hub/lib/sync'
import { PROVIDERS, SocialError, type Provider } from '@/modules/social-hub/lib/types'
import { publicOrigin } from '@/lib/security/public-origin'

export const maxDuration = 60

const BASIC_RETRY_COOKIE = 'shub_li_basic_retry'

type Params = { params: Promise<{ provider: string }> }

async function back(request: NextRequest, query: Record<string, string>): Promise<NextResponse> {
  const config = await prisma.siteConfig
    .findUnique({ where: { id: 'singleton' }, select: { adminPath: true } })
    .catch(() => null)
  const base = getSiteUrlOrNull() ?? publicOrigin(request)
  const url = new URL(`${base}/${config?.adminPath ?? 'cactus-admin'}/config`)
  url.searchParams.set('tab', 'social-hub')
  url.searchParams.set('view', 'accounts')
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  const res = NextResponse.redirect(url)
  res.cookies.delete(STATE_COOKIE)
  res.cookies.delete(BASIC_RETRY_COOKIE)
  return res
}

export async function GET(request: NextRequest, { params }: Params) {
  const g = await guard('manage')
  if ('response' in g) return g.response
  const { provider } = await params
  if (!PROVIDERS.includes(provider as Provider)) return back(request, { error: 'Unknown network.' })
  const p = provider as Provider

  const query = request.nextUrl.searchParams
  // An app whose Auth tab lacks the counts permission gets the whole sign-in refused, so ask again without it:
  // posting keeps working and the read notice then says which permission is missing.
  // The cookie marks the second try, so a refusal of the smaller set too ends in the plain error below rather than a loop.
  if (p === 'linkedin' && isLinkedInScopeRefusal(query.get('error')) && !request.cookies.get(BASIC_RETRY_COOKIE)) {
    const retry = NextResponse.redirect(new URL('/api/m/social-hub/oauth/linkedin/start?basic=1', publicOrigin(request)))
    retry.cookies.delete(STATE_COOKIE)
    retry.cookies.set(BASIC_RETRY_COOKIE, '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    })
    return retry
  }
  const denied = query.get('error_description') ?? query.get('error')
  if (denied) return back(request, { error: `${denied}` })

  const code = query.get('code')
  const cookie = request.cookies.get(STATE_COOKIE)?.value
  const redirect = readState(cookie, query.get('state'), p, g.access.userId)
  if (!code || !redirect) {
    return back(request, { error: 'That sign-in could not be checked (it may have expired). Please try connecting again.' })
  }

  try {
    const count = await completeConnection(p, code, g.access.userId, redirect)
    if (count === 0) {
      return back(request, {
        error: p === 'facebook'
          ? 'Facebook did not share any Pages. Tick the Pages you want to use when Facebook asks, and make sure you manage them.'
          : 'LinkedIn did not share any Pages. You need to be an admin of the LinkedIn Page, and your app needs the Community Management API.',
      })
    }
    // Read the pages' existing posts straight away so the feed is not empty on first look.
    await syncAll(Date.now() + 30_000).catch(() => undefined)
    await syncAttentionAlert()
    return back(request, { connected: p, count: String(count) })
  } catch (err) {
    return back(request, { error: err instanceof SocialError ? err.message : 'Connecting failed unexpectedly. Please try again.' })
  }
}
