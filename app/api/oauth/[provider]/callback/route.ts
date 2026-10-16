// GET /api/m/social-hub/oauth/:provider/callback - where Facebook or LinkedIn sends the admin back
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getSiteUrlOrNull } from '@/lib/config/env'
import { guard } from '@/modules/social-hub/lib/api'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import { completeConnection } from '@/modules/social-hub/lib/connect'
import { STATE_COOKIE, verifyState } from '@/modules/social-hub/lib/oauth-state'
import { syncAll } from '@/modules/social-hub/lib/sync'
import { PROVIDERS, SocialError, type Provider } from '@/modules/social-hub/lib/types'

export const maxDuration = 60

type Params = { params: Promise<{ provider: string }> }

async function back(request: NextRequest, query: Record<string, string>): Promise<NextResponse> {
  const config = await prisma.siteConfig
    .findUnique({ where: { id: 'singleton' }, select: { adminPath: true } })
    .catch(() => null)
  const base = getSiteUrlOrNull() ?? request.nextUrl.origin
  const url = new URL(`${base}/${config?.adminPath ?? 'cactus-admin'}/config`)
  url.searchParams.set('tab', 'social-hub')
  url.searchParams.set('view', 'accounts')
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  const res = NextResponse.redirect(url)
  res.cookies.delete(STATE_COOKIE)
  return res
}

export async function GET(request: NextRequest, { params }: Params) {
  const g = await guard('manage')
  if ('response' in g) return g.response
  const { provider } = await params
  if (!PROVIDERS.includes(provider as Provider)) return back(request, { error: 'Unknown network.' })
  const p = provider as Provider

  const query = request.nextUrl.searchParams
  const denied = query.get('error_description') ?? query.get('error')
  if (denied) return back(request, { error: `${denied}` })

  const code = query.get('code')
  const cookie = request.cookies.get(STATE_COOKIE)?.value
  if (!code || !verifyState(cookie, query.get('state'), p, g.access.userId)) {
    return back(request, { error: 'That sign-in could not be checked (it may have expired). Please try connecting again.' })
  }

  try {
    const count = await completeConnection(p, code, g.access.userId)
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
