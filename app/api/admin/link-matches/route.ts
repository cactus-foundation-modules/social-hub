// POST /api/m/social-hub/admin/link-matches { urls } - what each page has done with each web address
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { guard } from '@/modules/social-hub/lib/api'
import { matchPostedLinks } from '@/modules/social-hub/lib/posted-links'

const Body = z.object({ urls: z.array(z.string().max(2048)).max(2000) })

export async function POST(request: NextRequest) {
  const g = await guard('view')
  if ('response' in g) return g.response
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Send a list of web addresses.' }, { status: 400 })
  return NextResponse.json({ matches: await matchPostedLinks(parsed.data.urls) })
}
