import { describe, expect, it } from 'vitest'
import { isLinkedInVersionError, linkedInVersionCandidates } from '@/modules/social-hub/lib/linkedin'

describe('linkedInVersionCandidates', () => {
  it('starts at last month and steps back across the year boundary', () => {
    const got = linkedInVersionCandidates(new Date(Date.UTC(2026, 1, 15)))
    expect(got.slice(0, 3)).toEqual(['202601', '202512', '202511'])
    expect(got).toHaveLength(10)
  })
})

describe('isLinkedInVersionError', () => {
  it('spots a retired version', () => {
    expect(isLinkedInVersionError({ status: 426, json: { status: 426, code: 'NONEXISTENT_VERSION', message: 'Requested version 20251001 is not active' } })).toBe(true)
    expect(isLinkedInVersionError({ status: 400, json: { message: 'Requested version 20251001 is not active' } })).toBe(true)
  })
  it('leaves every other refusal alone', () => {
    expect(isLinkedInVersionError({ status: 401, json: { message: 'Invalid access token' } })).toBe(false)
    expect(isLinkedInVersionError({ status: 400, json: { message: 'Invalid commentary' } })).toBe(false)
  })
})
