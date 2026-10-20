import { SocialError, TIMEOUT_ERROR } from '@/modules/social-hub/lib/types'

const TIMEOUT_MS = 15_000

export type JsonResult = { status: number; ok: boolean; json: unknown; headers: Headers; text: string }

/** Sending a post can take a while: Facebook fetches the linked page and its picture before it answers. */
export const PUBLISH_TIMEOUT_MS = 30_000

/** fetch with a timeout, answering the body as JSON when it is. Never throws on a non-2xx. */
export async function requestJson(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<JsonResult> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw new SocialError(TIMEOUT_ERROR)
    throw new SocialError('The network could not be reached. Try again in a minute.')
  }
  const text = await res.text()
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
  }
  return { status: res.status, ok: res.ok, json, headers: res.headers, text }
}

export function formBody(values: Record<string, string | number | boolean | undefined | null>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  return params
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
