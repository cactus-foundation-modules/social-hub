import { getSiteUrlOrNull } from '@/lib/config/env'
import type { Provider } from '@/modules/social-hub/lib/types'

/**
 * The address the person is actually using to reach the admin.
 *
 * The networks will only send somebody back to an address that was typed into the
 * app on their side and whose domain is on its list. SITE_URL can lag behind the
 * address a site is really served on (an old domain that redirects, a www
 * variant), so building the redirect from it sends people somewhere the app was
 * never told about. What the browser used is the one address guaranteed to be
 * the one they are looking at.
 */
export function requestOrigin(headers: Headers, fallbackUrl: string): string {
  const host = headers.get('x-forwarded-host')?.split(',')[0]?.trim() || headers.get('host')?.trim()
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https')
    if (proto === 'http' || proto === 'https') return `${proto}://${host}`
  }
  try {
    return new URL(fallbackUrl).origin
  } catch {
    return getSiteUrlOrNull() ?? ''
  }
}

export function callbackUrl(provider: Provider, origin: string): string {
  return `${origin}/api/m/social-hub/oauth/${provider}/callback`
}
