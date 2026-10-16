// DELETE /api/m/social-hub/admin/accounts/:id - disconnect a page
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { syncAttentionAlert } from '@/modules/social-hub/lib/alerts'
import { deleteConnection } from '@/modules/social-hub/lib/connections'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(_request: NextRequest, { params }: Params) {
  const g = await guard('manage')
  if ('response' in g) return g.response
  const { id } = await params
  if (!(await deleteConnection(id))) return errorResponse('That page is not connected.', 404)
  await syncAttentionAlert()
  return NextResponse.json({ ok: true })
}
