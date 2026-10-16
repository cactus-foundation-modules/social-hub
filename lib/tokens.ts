import { replaceTokens, markNeedsReauth, type ConnectionSecrets } from '@/modules/social-hub/lib/connections'
import { refreshLinkedInToken } from '@/modules/social-hub/lib/linkedin'
import { getAppCredentials } from '@/modules/social-hub/lib/settings'
import { SocialError } from '@/modules/social-hub/lib/types'

const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const RECONNECT = 'This connection has expired. Reconnect the page in Settings → Social Hub.'

/**
 * A token that is good to use right now. Facebook page tokens do not expire, so
 * they pass straight through; a LinkedIn token lasts about sixty days and is
 * renewed a week early when LinkedIn gave us a refresh token to do it with.
 */
export async function usableToken(conn: ConnectionSecrets): Promise<string> {
  if (!conn.accessToken) {
    await markNeedsReauth(conn.id, 'The stored credentials could not be read.')
    throw new SocialError('The saved credentials for this page cannot be read any more. Reconnect it in Settings → Social Hub.', true)
  }
  if (conn.provider !== 'linkedin' || !conn.tokenExpiresAt) return conn.accessToken

  const expiresAt = Date.parse(conn.tokenExpiresAt)
  if (expiresAt - Date.now() > REFRESH_WINDOW_MS) return conn.accessToken

  const stillValid = expiresAt > Date.now()
  const refreshOk = !!conn.refreshToken && (!conn.refreshExpiresAt || Date.parse(conn.refreshExpiresAt) > Date.now())
  if (refreshOk) {
    const creds = await getAppCredentials('linkedin')
    if (creds) {
      try {
        const fresh = await refreshLinkedInToken(creds, conn.refreshToken!)
        await replaceTokens(conn.id, fresh)
        return fresh.accessToken
      } catch (err) {
        if (stillValid) return conn.accessToken
        const message = err instanceof SocialError ? err.message : RECONNECT
        await markNeedsReauth(conn.id, message)
        throw new SocialError(RECONNECT, true)
      }
    }
  }
  if (stillValid) return conn.accessToken
  await markNeedsReauth(conn.id, RECONNECT)
  throw new SocialError(RECONNECT, true)
}
