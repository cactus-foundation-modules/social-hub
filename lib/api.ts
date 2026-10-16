
import { getHubAccess, type HubAccess } from '@/modules/social-hub/lib/auth'
import { errorResponse } from '@/lib/utils'

export type Need = 'view' | 'post' | 'manage'

/** Resolve the caller's access and refuse them if it is not enough. */
export async function guard(need: Need): Promise<{ access: HubAccess } | { response: Response }> {
  const access = await getHubAccess()
  if (!access) return { response: errorResponse('Not authenticated', 401) }
  const ok = need === 'view' ? access.canView : need === 'post' ? access.canPost : access.canManage
  if (!ok) return { response: errorResponse('You do not have permission to do that.', 403) }
  return { access }
}
