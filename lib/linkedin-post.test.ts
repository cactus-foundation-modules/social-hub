import { describe, expect, it } from 'vitest'
import { linkedInCommentary, linkedInImages } from '@/modules/social-hub/lib/linkedin-text'
import type { PublishInput } from '@/modules/social-hub/lib/provider-types'

const base: PublishInput = { body: 'Read this', linkUrl: null, linkTitle: null, linkDescription: null, linkImageUrl: null, images: [] }

describe('linkedInCommentary', () => {
  it('puts the link at the foot of the text', () => {
    expect(linkedInCommentary('Read this\n', 'https://example.com/a')).toBe('Read this\n\nhttps://example.com/a')
    expect(linkedInCommentary('', 'https://example.com/a')).toBe('https://example.com/a')
  })
  it('leaves text that already carries the link, or has none, alone', () => {
    expect(linkedInCommentary('See https://example.com/a today', 'https://example.com/a')).toBe('See https://example.com/a today')
    expect(linkedInCommentary('Just words', null)).toBe('Just words')
  })
})

describe('linkedInImages', () => {
  it("uses the link's picture when the post has none of its own", () => {
    expect(linkedInImages({ ...base, linkTitle: 'A post', linkImageUrl: 'https://cdn.example.com/a.webp' }))
      .toEqual([{ url: 'https://cdn.example.com/a.webp', alt: 'A post' }])
  })
  it("prefers the post's own pictures, at most four", () => {
    const own = Array.from({ length: 5 }, (_, i) => ({ url: `https://cdn.example.com/${i}.jpg` }))
    expect(linkedInImages({ ...base, images: own, linkImageUrl: 'https://cdn.example.com/a.webp' })).toEqual(own.slice(0, 4))
  })
  it('has nothing to attach without a picture', () => {
    expect(linkedInImages(base)).toEqual([])
  })
})
