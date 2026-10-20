import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestJson = vi.fn()
vi.mock('@/modules/social-hub/lib/http', async (orig) => ({
  ...(await orig<typeof import('@/modules/social-hub/lib/http')>()),
  requestJson: (...args: unknown[]) => requestJson(...args),
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import { findPublishedOnFacebook } from '@/modules/social-hub/lib/facebook'
import { AUTO_ATTEMPTS, isRetryOwed } from '@/modules/social-hub/lib/posts'
import { INTERRUPTED_ERROR, outcomeUncertain, TIMEOUT_ERROR, UNCHECKED_ERROR } from '@/modules/social-hub/lib/types'

const rows = (data: unknown[]) => ({ ok: true, status: 200, headers: new Headers(), text: '', json: { data } })
const input = { body: 'Chair mats: save the carpet', linkUrl: 'https://deskwell.co.uk/mats', linkTitle: null, linkDescription: null, linkImageUrl: null, images: [] }
const since = new Date('2026-10-20T14:00:00Z')

beforeEach(() => requestJson.mockReset())

describe('looking for a post that may already have gone out', () => {
  it('finds it by its words, whatever Facebook did to the spacing', async () => {
    requestJson.mockResolvedValueOnce(rows([{ id: '9_1', message: 'Chair mats:  save the carpet\n', created_time: '2026-10-20T15:00:20+0000', permalink_url: '/9/posts/1' }]))
    expect(await findPublishedOnFacebook('9', 't', input, since)).toEqual({ externalId: '9_1', permalink: 'https://www.facebook.com/9/posts/1' })
  })

  it('ignores a post with the same words from before this one existed', async () => {
    requestJson.mockResolvedValueOnce(rows([{ id: '9_0', message: input.body, created_time: '2026-09-01T10:00:00+0000' }]))
    expect(await findPublishedOnFacebook('9', 't', input, since)).toBeNull()
  })

  it('says nothing is there when the page has no match', async () => {
    requestJson.mockResolvedValueOnce(rows([{ id: '9_2', message: 'Something else', created_time: '2026-10-20T15:00:20+0000' }]))
    expect(await findPublishedOnFacebook('9', 't', input, since)).toBeNull()
  })

  it('throws, rather than guessing, when the page cannot be read', async () => {
    requestJson.mockResolvedValueOnce({ ok: false, status: 400, headers: new Headers(), text: '', json: { error: { code: 200, message: 'nope' } } })
    await expect(findPublishedOnFacebook('9', 't', input, since)).rejects.toThrow()
  })

  it('throws when the post has no words to look for', async () => {
    await expect(findPublishedOnFacebook('9', 't', { ...input, body: ' ', linkUrl: null }, since)).rejects.toThrow()
  })
})

describe('which attempts are worth retrying alone', () => {
  const owed = { provider: 'facebook' as const, status: 'failed' as const, attempts: 1, error: TIMEOUT_ERROR }
  it('retries a Facebook timeout once', () => {
    expect(isRetryOwed(owed)).toBe(true)
    expect(isRetryOwed({ ...owed, attempts: AUTO_ATTEMPTS })).toBe(false)
  })
  it('leaves refusals, other networks and unfinished targets alone', () => {
    expect(isRetryOwed({ ...owed, error: 'Facebook says this connection is missing a permission' })).toBe(false)
    expect(isRetryOwed({ ...owed, provider: 'linkedin' })).toBe(false)
    expect(isRetryOwed({ ...owed, status: 'pending' })).toBe(false)
  })
  it('treats silence as uncertain, and a refusal as certain', () => {
    expect(outcomeUncertain(TIMEOUT_ERROR)).toBe(true)
    expect(outcomeUncertain(INTERRUPTED_ERROR)).toBe(true)
    expect(outcomeUncertain(UNCHECKED_ERROR)).toBe(true)
    expect(outcomeUncertain('Facebook says this connection is missing a permission')).toBe(false)
    expect(outcomeUncertain(null)).toBe(false)
  })
})
