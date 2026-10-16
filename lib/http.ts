import { SocialError } from '@/modules/social-hub/lib/types'

const TIMEOUT_MS = 15_000

export type JsonResult = { status: number; ok: boolean; json: unknown; headers: Headers; text: string }

/** fetch with a timeout, answering the body as JSON when it is. Never throws on a non-2xx. */
export async function requestJson(url: string, init: RequestInit = {}): Promise<JsonResult> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'took too long to answer' : 'could not be reached'
    throw new SocialError(`The network ${reason}. Try again in a minute.`)
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
