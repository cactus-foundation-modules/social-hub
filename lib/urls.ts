// Client-safe URL helpers (no node imports - the composer uses these in the browser).

/** The first web address in a piece of text, ignoring trailing punctuation. */
export function firstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return null
  return match[0].replace(/[.,;:!?)\]}]+$/, '')
}

/** Route a remote picture through the admin-only proxy: the site's CSP allows no third-party image hosts. */
export function proxiedImage(url: string): string {
  if (url.startsWith('/') || url.startsWith('data:') || url.startsWith('blob:')) return url
  return `/api/m/social-hub/admin/image?u=${encodeURIComponent(url)}`
}
