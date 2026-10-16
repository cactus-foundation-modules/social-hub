// Thin fetch helpers for the admin screens. Every call answers { ok, data } or { ok:false, error }
// so a component never has to wrap a try/catch of its own.

const BASE = '/api/m/social-hub'

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null
    if (!res.ok) return { ok: false, error: json?.error ?? `Something went wrong (${res.status}).` }
    return { ok: true, data: json as T }
  } catch {
    return { ok: false, error: 'Could not reach the site. Check your connection and try again.' }
  }
}
