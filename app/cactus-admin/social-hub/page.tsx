import { getSessionFromCookie } from '@/lib/auth/session'
import { accessFor } from '@/modules/social-hub/lib/auth'
import SocialHubApp from '@/modules/social-hub/components/admin/SocialHubApp'

export const metadata = { title: 'Social Hub — Admin' }

export default async function SocialHubPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  const access = await accessFor(user)
  if (!access.canView) {
    return <div className="alert alert-danger">You do not have permission to see Social Hub.</div>
  }
  return <SocialHubApp />
}
