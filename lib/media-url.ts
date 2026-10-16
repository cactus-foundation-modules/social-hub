import { getSiteUrlOrNull } from '@/lib/config/env'

/** The networks fetch pictures themselves, so a site-relative library path has to become a full address. */
export function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  const base = getSiteUrlOrNull()
  if (!base) return url
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`
}
