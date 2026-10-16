import { clearAlert, upsertAlert } from '@/lib/notifications/alerts'
import { listConnections } from '@/modules/social-hub/lib/connections'
import { failedPostCount } from '@/modules/social-hub/lib/posts'

const KEY = 'social-hub:attention'

/** One rolling bell notification: posts that did not go out, and pages that need reconnecting. Never throws. */
export async function syncAttentionAlert(): Promise<void> {
  try {
    const [failed, connections] = await Promise.all([failedPostCount(), listConnections()])
    const stale = connections.filter((c) => c.status === 'needs_reauth').length
    const parts: string[] = []
    if (failed > 0) parts.push(`${failed} post${failed === 1 ? '' : 's'} did not go out`)
    if (stale > 0) parts.push(`${stale} page${stale === 1 ? '' : 's'} need${stale === 1 ? 's' : ''} reconnecting`)
    if (parts.length === 0) {
      await clearAlert(KEY)
      return
    }
    const title = `Social Hub: ${parts.join(', ')}`
    await upsertAlert({ type: 'message', dedupeKey: KEY, title: title.charAt(0).toUpperCase() + title.slice(1), link: '/m/social-hub' })
  } catch {
    // A notification failing must never break the thing that raised it.
  }
}
