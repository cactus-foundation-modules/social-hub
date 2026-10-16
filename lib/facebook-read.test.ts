import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestJson = vi.fn()
vi.mock('@/modules/social-hub/lib/http', async (orig) => ({
  ...(await orig<typeof import('@/modules/social-hub/lib/http')>()),
  requestJson: (...args: unknown[]) => requestJson(...args),
}))

import { fetchFacebookPosts } from '@/modules/social-hub/lib/facebook'

const ok = (data: unknown[], next = false) => ({
  ok: true, status: 200, headers: new Headers(), text: '',
  json: { data, ...(next ? { paging: { cursors: { after: 'c' }, next: 'x' } } : {}) },
})
const refused = (message: string) => ({
  ok: false, status: 400, headers: new Headers(), text: '',
  json: { error: { code: 200, message } },
})
const post = (n: number) => ({ id: `1_${n}`, message: `m${n}`, created_time: '2026-09-08T08:00:00+0000', permalink_url: `/p/${n}` })
const fieldsOf = (call: number) => new URL(requestJson.mock.calls[call]![0] as string).searchParams.get('fields') ?? ''

beforeEach(() => requestJson.mockReset())

describe('reading a Facebook page', () => {
  it('has nothing to report when Facebook shares everything', async () => {
    requestJson.mockResolvedValueOnce(ok([post(1)]))
    const read = await fetchFacebookPosts('1', 't')
    expect(read.posts).toHaveLength(1)
    expect(read.notice).toBeNull()
  })

  it('steps down when the counts are refused, keeps the attachments, and says so with the reason', async () => {
    requestJson.mockResolvedValueOnce(refused('(#200) Requires pages_read_engagement'))
    requestJson.mockResolvedValueOnce(ok([post(1)]))
    const read = await fetchFacebookPosts('1', 't')
    expect(fieldsOf(1)).toContain('attachments')
    expect(fieldsOf(1)).not.toContain('likes')
    expect(fieldsOf(1)).toContain('shares')
    expect(read.notice).toMatch(/like and comment counts/)
    expect(read.notice).toMatch(/Requires pages_read_engagement/)
  })

  it('warns that Gazette cannot be matched when only the bare post is allowed', async () => {
    requestJson.mockResolvedValueOnce(refused('no'))
    requestJson.mockResolvedValueOnce(refused('no'))
    requestJson.mockResolvedValueOnce(refused('no'))
    requestJson.mockResolvedValueOnce(ok([post(1)]))
    const read = await fetchFacebookPosts('1', 't')
    expect(read.notice).toMatch(/Gazette posts cannot be matched/)
    expect(fieldsOf(0)).not.toMatch(/(^|,)link(,|$)/)
  })

  it('throws when even the bare post is refused', async () => {
    requestJson.mockResolvedValue(refused('nothing allowed'))
    await expect(fetchFacebookPosts('1', 't')).rejects.toThrow()
  })

  it('follows the pages, keeping the same request, and reports a later page failing', async () => {
    const full = Array.from({ length: 25 }, (_, i) => post(i))
    requestJson.mockResolvedValueOnce(ok(full, true))
    requestJson.mockResolvedValueOnce(refused('page two refused'))
    const read = await fetchFacebookPosts('1', 't')
    expect(read.posts).toHaveLength(25)
    expect(read.notice).toMatch(/Older posts could not be read/)
    expect(requestJson).toHaveBeenCalledTimes(2)
    expect(fieldsOf(1)).toBe(fieldsOf(0))
  })
})

import { deleteFacebookPost } from '@/modules/social-hub/lib/facebook'
import { deleteLinkedInPost } from '@/modules/social-hub/lib/linkedin'

const answer = (status: number, json: unknown = null) => ({ ok: status >= 200 && status < 300, status, json, headers: new Headers(), text: '' })

describe('deleting a post from the network', () => {
  it('Facebook: deleted', async () => {
    requestJson.mockResolvedValueOnce(answer(200, { success: true }))
    expect(await deleteFacebookPost('t', '1_2')).toBe('deleted')
    expect(requestJson.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' })
  })
  it('Facebook: already gone counts as done', async () => {
    requestJson.mockResolvedValueOnce(answer(400, { error: { code: 100, error_subcode: 33, message: 'does not exist' } }))
    expect(await deleteFacebookPost('t', '1_2')).toBe('gone')
  })
  it('Facebook: a refusal is an error, never a silent success', async () => {
    requestJson.mockResolvedValueOnce(answer(403, { error: { code: 200, message: 'no permission' } }))
    await expect(deleteFacebookPost('t', '1_2')).rejects.toThrow(/permission/)
  })
  it('Facebook: success:false is not success', async () => {
    requestJson.mockResolvedValueOnce(answer(200, { success: false }))
    await expect(deleteFacebookPost('t', '1_2')).rejects.toThrow()
  })
  it('LinkedIn: deletes by encoded urn', async () => {
    requestJson.mockResolvedValueOnce(answer(204))
    expect(await deleteLinkedInPost('t', 'urn:li:share:123')).toBe('deleted')
    expect(requestJson.mock.calls[0]![0]).toContain('urn%3Ali%3Ashare%3A123')
  })
  it('LinkedIn: 404 is gone, 403 is an error', async () => {
    requestJson.mockResolvedValueOnce(answer(404))
    expect(await deleteLinkedInPost('t', 'urn:li:share:1')).toBe('gone')
    requestJson.mockResolvedValueOnce(answer(403, { message: 'nope' }))
    await expect(deleteLinkedInPost('t', 'urn:li:share:1')).rejects.toThrow(/refused/)
  })
})
