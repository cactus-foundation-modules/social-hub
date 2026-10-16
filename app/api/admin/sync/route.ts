// POST /api/m/social-hub/admin/sync { connectionId? } - read the pages again now
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { syncAll } from '@/modules/social-hub/lib/sync'

export const maxDuration = 60

const Body = z.object({ connectionId: z.string().min(1).max(100).optional() })

export async function POST(request: NextRequest) {
  const g = await guard('post')
  if ('response' in g) return g.response
  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return errorResponse('Invalid request', 400)
  const results = await syncAll(Date.now() + 45_000, parsed.data.connectionId)
  return NextResponse.json({ results })
}
