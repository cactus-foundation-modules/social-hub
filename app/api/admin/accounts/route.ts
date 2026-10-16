// GET /api/m/social-hub/admin/accounts - connected pages, which networks are set up, and post counts
import { NextResponse } from 'next/server'
import { guard } from '@/modules/social-hub/lib/api'
import { listConnections } from '@/modules/social-hub/lib/connections'
import { countPosts } from '@/modules/social-hub/lib/posts'
import { getAppCredentials } from '@/modules/social-hub/lib/settings'

export async function GET() {
  const g = await guard('view')
  if ('response' in g) return g.response
  const [connections, counts, fb, li] = await Promise.all([
    listConnections(),
    countPosts(),
    getAppCredentials('facebook'),
    getAppCredentials('linkedin'),
  ])
  return NextResponse.json({
    connections,
    counts,
    configured: { facebook: !!fb, linkedin: !!li },
    can: g.access,
  })
}
