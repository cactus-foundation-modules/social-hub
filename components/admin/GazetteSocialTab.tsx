'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAdminPath } from '@/components/admin/AdminPathContext'
import { PROVIDER_LABEL, type Connection, type Provider } from '@/modules/social-hub/lib/types'
import type { LinkHit, LinkMatches } from '@/modules/social-hub/lib/link-match'
import { api } from '@/modules/social-hub/components/admin/hub/api'
import { Composer } from '@/modules/social-hub/components/admin/hub/Composer'
import { fullDateTime } from '@/modules/social-hub/components/admin/hub/format'
import '@/modules/social-hub/components/admin/hub/hub.css'

// The shape Gazette hands to a tab published into its `gazette.admin-tabs` point.
// Declared here rather than imported, because Social Hub has to build and run on a
// site that has no Gazette.
type SharablePost = {
  id: string
  title: string
  excerpt: string | null
  /** The post's full web address. */
  url: string
  status: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED'
  /** When it went, or is due to go, live on the site. */
  date: string | null
  /** False for a draft, a post not live yet, or a members-only one: there is no public address to share. */
  canShare: boolean
}

type Meta = { connections: Connection[]; can: { canPost: boolean } }

const PROVIDERS: Provider[] = ['facebook', 'linkedin']
const PAGE_SIZE = 25

type Filter = 'any' | 'on' | 'scheduled' | 'none'
type Standing = Exclude<Filter, 'any'>

const FILTER_LABEL: Record<Filter, string> = {
  any: 'Any',
  on: 'Posted',
  scheduled: 'Scheduled',
  none: 'Not posted',
}

/** Where a post stands on one network, across all of that network's pages. */
function standing(hits: LinkHit[]): Standing {
  if (hits.some((h) => h.state === 'published')) return 'on'
  if (hits.some((h) => h.state === 'scheduled')) return 'scheduled'
  return 'none'
}

type PostTarget = { post: SharablePost; provider: Provider }

export function GazetteSocialTab({ posts }: { posts: SharablePost[] }) {
  const adminPath = useAdminPath()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [matches, setMatches] = useState<LinkMatches>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<Provider, Filter>>({ facebook: 'any', linkedin: 'any' })
  const [page, setPage] = useState(1)
  const [posting, setPosting] = useState<PostTarget | null>(null)

  // Built once per press of Post, so the sheet sees the same object for as long as it is open.
  const prefill = useMemo(
    () => posting && {
      text: [posting.post.title, posting.post.excerpt].filter(Boolean).join('\n\n'),
      linkUrl: posting.post.url,
      provider: posting.provider,
    },
    [posting],
  )

  const urls = useMemo(() => posts.map((p) => p.url), [posts])

  const load = useCallback(async () => {
    const [m, l] = await Promise.all([
      api<Meta>('/admin/accounts'),
      urls.length > 0 ? api<{ matches: LinkMatches }>('/admin/link-matches', { method: 'POST', body: { urls } }) : Promise.resolve(null),
    ])
    if (!m.ok) setError(m.error)
    else setMeta(m.data)
    if (l && !l.ok) setError(l.error)
    else if (l) { setMatches(l.data.matches); if (m.ok) setError('') }
    setLoading(false)
  }, [urls])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set after the response, never synchronously
  useEffect(() => { void load() }, [load])

  const connectionsBy = useMemo(() => {
    const out: Record<Provider, Connection[]> = { facebook: [], linkedin: [] }
    for (const c of meta?.connections ?? []) out[c.provider].push(c)
    return out
  }, [meta])

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return posts.filter((p) => {
      if (needle && !p.title.toLowerCase().includes(needle)) return false
      return PROVIDERS.every((provider) => {
        const wanted = filters[provider]
        return wanted === 'any' || standing(matches[p.url]?.[provider] ?? []) === wanted
      })
    })
  }, [posts, matches, filters, search])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, totalPages)
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  function setFilter(provider: Provider, value: Filter) {
    setFilters((cur) => ({ ...cur, [provider]: value }))
    setPage(1)
  }

  async function afterSave(message: string) {
    setPosting(null)
    setNotice(message)
    await load()
  }

  function cell(post: SharablePost, provider: Provider) {
    const pages = connectionsBy[provider]
    if (pages.length === 0) {
      return <span style={{ color: 'var(--color-text-secondary)' }}>No {PROVIDER_LABEL[provider]} page connected</span>
    }
    const hits = matches[post.url]?.[provider] ?? []
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        {pages.map((page) => {
          const hit = hits.find((h) => h.connectionId === page.id)
          return (
            <div key={page.id}>
              {pages.length > 1 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{page.name}</div>
              )}
              {hit?.state === 'published' ? (
                <span>
                  <span className="badge badge-success">Posted</span>{' '}
                  {hit.permalink ? (
                    <a href={hit.permalink} target="_blank" rel="noopener noreferrer">View post</a>
                  ) : (
                    <span style={{ color: 'var(--color-text-secondary)' }}>no link available</span>
                  )}
                  {hit.at && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{fullDateTime(hit.at)}</div>}
                </span>
              ) : hit?.state === 'scheduled' ? (
                <span>
                  <span className="badge badge-info">Scheduled</span>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                    {hit.at ? `Due ${fullDateTime(hit.at)}` : 'Due soon'}
                  </div>
                </span>
              ) : (
                <span>
                  {hit?.state === 'failed' ? (
                    <span className="badge badge-danger" title={hit.error ?? undefined}>Failed</span>
                  ) : (
                    <span style={{ color: 'var(--color-text-secondary)' }}>Not posted</span>
                  )}{' '}
                  {meta?.can.canPost && post.canShare && page.status === 'active' ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPosting({ post, provider })}>
                      {hit?.state === 'failed' ? 'Try again' : 'Post'}
                    </button>
                  ) : null}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (loading) return <p style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>

  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8125rem' }}>
          Search
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by title…"
            style={{ padding: '0.375rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: '0.875rem', fontFamily: 'inherit', background: 'var(--color-bg)', color: 'var(--color-text)' }}
          />
        </label>
        {PROVIDERS.map((provider) => (
          <label key={provider} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8125rem' }}>
            {PROVIDER_LABEL[provider]}
            <select
              value={filters[provider]}
              onChange={(e) => setFilter(provider, e.target.value as Filter)}
              style={{ padding: '0.375rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: '0.875rem', fontFamily: 'inherit', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            >
              {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                <option key={f} value={f}>{FILTER_LABEL[f]}</option>
              ))}
            </select>
          </label>
        ))}
        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginLeft: 'auto' }}>
          {rows.length} of {posts.length} posts
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '3rem' }}>
          {posts.length === 0 ? 'No gazette posts yet.' : 'No posts match those filters.'}
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Post</th>
                <th>Facebook</th>
                <th>LinkedIn</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((post) => (
                <tr key={post.id}>
                  <td>
                    <a href={`/${adminPath}/m/gazette/posts/${post.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>{post.title}</a>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                      {post.status === 'PUBLISHED' ? 'Published' : post.status === 'SCHEDULED' ? 'Going live' : 'Draft'}
                      {post.date ? ` ${fullDateTime(post.date)}` : ''}
                    </div>
                  </td>
                  <td>{cell(post, 'facebook')}</td>
                  <td>{cell(post, 'linkedin')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'center' }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</button>
          <span style={{ lineHeight: '2rem', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Page {current} of {totalPages}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={current >= totalPages} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      )}

      {prefill && meta && (
        <Composer
          connections={meta.connections}
          editing={null}
          prefill={prefill}
          onSaved={afterSave}
          onClose={() => setPosting(null)}
        />
      )}
    </div>
  )
}
