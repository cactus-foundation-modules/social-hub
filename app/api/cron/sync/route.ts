import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { syncAll } from '@/modules/social-hub/lib/sync'

// Re-reads what is on each connected page so the feed stays current.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return errorResponse('CRON_SECRET is not configured', 503)
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return errorResponse('Unauthorized', 401)
  const results = await syncAll(Date.now() + 40_000)
  return NextResponse.json({ ok: true, pages: results.length, failed: results.filter((r) => !r.ok).length })
}
