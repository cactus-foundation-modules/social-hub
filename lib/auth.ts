import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'

export type HubAccess = { userId: string; canView: boolean; canPost: boolean; canManage: boolean }

type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionFromCookie>>>

/** Resolve what this person may do here. Null when nobody is signed in. */
export async function getHubAccess(): Promise<HubAccess | null> {
  const user = await getSessionFromCookie()
  if (!user) return null
  return accessFor(user)
}

export async function accessFor(user: SessionUser): Promise<HubAccess> {
  const [canView, canPost, canManage] = await Promise.all([
    hasPermission(user, 'socialhub.view'),
    hasPermission(user, 'socialhub.post'),
    hasPermission(user, 'socialhub.manage'),
  ])
  // Anyone who can post or manage can obviously see what they are posting to.
  return { userId: user.id, canView: canView || canPost || canManage, canPost, canManage }
}
