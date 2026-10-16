import { randomBytes } from 'node:crypto'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import type { Provider } from '@/modules/social-hub/lib/types'

export const STATE_COOKIE = 'shub_oauth'
export const STATE_TTL_SECONDS = 600

type Payload = { p: Provider; n: string; u: string; e: number }

/** A one-off value for the OAuth `state` parameter, plus the sealed cookie that proves we issued it. */
export function createState(provider: Provider, userId: string, now = Date.now()): { state: string; cookie: string } {
  const nonce = randomBytes(18).toString('base64url')
  const payload: Payload = { p: provider, n: nonce, u: userId, e: now + STATE_TTL_SECONDS * 1000 }
  return { state: nonce, cookie: encryptSecret(JSON.stringify(payload)) }
}

/** True only if the cookie is ours, unexpired, for this network and person, and matches the state the network echoed. */
export function verifyState(
  cookie: string | undefined,
  state: string | null,
  provider: Provider,
  userId: string,
  now = Date.now(),
): boolean {
  if (!cookie || !state) return false
  try {
    const payload = JSON.parse(decryptSecret(cookie)) as Payload
    return payload.p === provider && payload.u === userId && payload.n === state && payload.e > now
  } catch {
    return false
  }
}
