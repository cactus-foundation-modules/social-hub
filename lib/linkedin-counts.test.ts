import { describe, expect, it } from 'vitest'
import { LI_SCOPES, countsNotice, linkedInAuthUrl, readSocialCounts } from '@/modules/social-hub/lib/linkedin'

describe('readSocialCounts', () => {
  it('reads a post with likes and comments', () => {
    const got = readSocialCounts({
      ok: true,
      status: 200,
      json: { likesSummary: { totalLikes: 4 }, commentsSummary: { aggregatedTotalComments: 2, totalFirstLevelComments: 1 } },
    })
    expect(got).toEqual({ ok: true, likes: 4, comments: 2 })
  })
  it('treats the empty answer for an untouched post as zero, not a refusal', () => {
    expect(readSocialCounts({ ok: true, status: 200, json: {} })).toEqual({ ok: true, likes: 0, comments: 0 })
  })
  it('keeps the refusal and LinkedIn’s reason', () => {
    expect(readSocialCounts({ ok: false, status: 403, json: { message: 'Not enough permissions' } }))
      .toEqual({ ok: false, status: 403, reason: 'Not enough permissions' })
  })
})

describe('countsNotice', () => {
  it('says nothing when a quiet page simply has no likes', () => {
    expect(countsNotice([{ ok: true, likes: 0, comments: 0 }, { ok: true, likes: 0, comments: 0 }])).toBeNull()
  })
  it('says nothing when only some posts failed', () => {
    expect(countsNotice([{ ok: false, status: 500, reason: null }, { ok: true, likes: 1, comments: 0 }])).toBeNull()
  })
  it('names the missing permission and LinkedIn’s reason when every post is refused', () => {
    const notice = countsNotice([{ ok: false, status: 403, reason: 'Not enough permissions' }, null])
    expect(notice).toContain('LinkedIn said: Not enough permissions')
    expect(notice).toContain('r_organization_social_feed')
  })
})

describe('linkedInAuthUrl', () => {
  const creds = { clientId: 'id', clientSecret: 'secret', configId: null }
  it('asks for the counts permission by default', () => {
    expect(LI_SCOPES).toContain('r_organization_social_feed')
    expect(new URL(linkedInAuthUrl(creds, 'https://x/cb', 's')).searchParams.get('scope')).toContain('r_organization_social_feed')
  })
  it('leaves it out on the basic retry', () => {
    expect(new URL(linkedInAuthUrl(creds, 'https://x/cb', 's', true)).searchParams.get('scope')).not.toContain('r_organization_social_feed')
  })
})
