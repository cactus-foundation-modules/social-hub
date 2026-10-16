// GET /api/m/social-hub/admin/feed?connection=<id> - posts already on the pages, as last read
import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/modules/social-hub/lib/api'
import { listFeed } from '@/modules/social-hub/lib/sync'

export async function GET(request: NextRequest) {
  const g = await guard('view')
  if ('response' in g) return g.response
  const connection = request.nextUrl.searchParams.get('connection')
  return NextResponse.json({ posts: await listFeed(connection || null) })
}
