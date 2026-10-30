import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/modules/social-hub/lib/api', () => ({ guard: async () => ({ access: { userId: 'u1' } }) }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { siteConfig: { findUnique: async () => ({ adminPath: 'adm' }) } } }))
vi.mock('@/lib/crypto/secrets', () => ({ isEncryptionKeyUsable: () => true }))
vi.mock('@/modules/social-hub/lib/settings', () => ({ getSettings: async () => ({}), updateSettings: vi.fn() }))

const { GET } = await import('@/modules/social-hub/app/api/admin/settings/route')

let saved: Array<[string, string | undefined]> = []
beforeEach(() => {
  saved = ['CACTUS_HOSTING_PROVIDER', 'SITE_URL', 'VERCEL'].map((k) => [k, process.env[k]])
  delete process.env.VERCEL
  process.env.CACTUS_HOSTING_PROVIDER = 'server'
  process.env.SITE_URL = 'https://shop.example'
})
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

it('falls back to the public address, not the bind address, when no Host header is usable', async () => {
  const request = new NextRequest('https://localhost:3101/api/m/social-hub/admin/settings', {
    headers: { host: 'bad host!' },
  })
  const body = await (await GET(request)).json()
  expect(body.siteUrl).toBe('https://shop.example')
  expect(body.redirectUris.facebook).toBe('https://shop.example/api/m/social-hub/oauth/facebook/callback')
})
