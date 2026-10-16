import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { PUBLISH_BUDGET_MS, runDuePosts } from '@/modules/social-hub/lib/publish'

// Sends every scheduled post whose time has come. It runs inside the site's single
// cron dispatcher, so a post goes out "on or after" its time - as soon as the next
// tick after it, and sooner if somebody presses Post now.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return errorResponse('CRON_SECRET is not configured', 503)
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return errorResponse('Unauthorized', 401)
  const result = await runDuePosts(Date.now() + PUBLISH_BUDGET_MS)
  return NextResponse.json({ ok: true, ...result })
}
