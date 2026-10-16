// POST /api/m/social-hub/admin/test-calls { connectionId } - make the calls Meta's App Review asks to see, on one Facebook page
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { getConnectionWithSecrets } from '@/modules/social-hub/lib/connections'
import { runFacebookTestCalls } from '@/modules/social-hub/lib/facebook-test-calls'
import { usableToken } from '@/modules/social-hub/lib/tokens'
import { SocialError } from '@/modules/social-hub/lib/types'

export const maxDuration = 60

const Body = z.object({ connectionId: z.string().min(1).max(100) })

export async function POST(request: NextRequest) {
  const g = await guard('manage')
  if ('response' in g) return g.response
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('Invalid request', 400)
  const conn = await getConnectionWithSecrets(parsed.data.connectionId)
  if (!conn || conn.provider !== 'facebook') return errorResponse('That Facebook page is not connected.', 404)
  if (conn.status !== 'active') return errorResponse(`${conn.name} needs reconnecting first.`, 400)
  try {
    const token = await usableToken(conn)
    return NextResponse.json({ results: await runFacebookTestCalls(conn.externalId, token) })
  } catch (err) {
    return errorResponse(err instanceof SocialError ? err.message : 'The test calls could not be made.', 400)
  }
}
