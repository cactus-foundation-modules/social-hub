'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAdminPath } from '@/components/admin/AdminPathContext'
import { useAdminConfirm } from '@/components/admin/useAdminConfirm'
import { useTabParam } from '@/components/admin/useTabParam'
import { PROVIDER_LABEL, type Connection, type Post, type PostStatus, type RemotePost } from '@/modules/social-hub/lib/types'
import { api } from '@/modules/social-hub/components/admin/hub/api'
import { Masonry } from '@/modules/social-hub/components/admin/hub/Masonry'
import { Composer } from '@/modules/social-hub/components/admin/hub/Composer'
import { Avatar } from '@/modules/social-hub/components/admin/hub/Parts'
import { LocalPostRow, RemotePostRow } from '@/modules/social-hub/components/admin/hub/PostCards'
import { Icon } from '@/modules/social-hub/components/admin/hub/Glyphs'
import '@/modules/social-hub/components/admin/hub/hub.css'

type Meta = {
  connections: Connection[]
  counts: Record<PostStatus, number>
  configured: { facebook: boolean; linkedin: boolean }
  can: { canPost: boolean; canManage: boolean }
}

const VIEWS = ['published', 'scheduled', 'drafts', 'issues'] as const
type View = (typeof VIEWS)[number]

export default function SocialHubApp() {
  const adminPath = useAdminPath()
  const settingsHref = `/${adminPath}/config?tab=social-hub`
  const [view, setView] = useTabParam<View>('view', 'published', VIEWS)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [feed, setFeed] = useState<RemotePost[]>([])
  const [local, setLocal] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [composer, setComposer] = useState<{ editing: Post | null } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [askConfirm, confirmNode] = useAdminConfirm()

  const loadMeta = useCallback(async () => {
    const res = await api<Meta>('/admin/accounts')
    if (res.ok) setMeta(res.data)
    else setError(res.error)
  }, [])

  const loadList = useCallback(async (v: View, connection: string | null) => {
    setLoading(true)
    if (v === 'published') {
      const res = await api<{ posts: RemotePost[] }>(`/admin/feed${connection ? `?connection=${encodeURIComponent(connection)}` : ''}`)
      if (res.ok) { setFeed(res.data.posts); setError('') } else setError(res.error)
    } else {
      const res = await api<{ posts: Post[] }>(`/admin/posts?view=${v}`)
      if (res.ok) { setLocal(res.data.posts); setError('') } else setError(res.error)
    }
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set after the response, never synchronously
  useEffect(() => { void loadMeta() }, [loadMeta])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch when the view or page filter changes; state is set after the response
  useEffect(() => { void loadList(view, filter) }, [view, filter, loadList])

  async function refresh() {
    setRefreshing(true)
    const res = await api<{ results: { ok: boolean; error?: string }[] }>('/admin/sync', { method: 'POST', body: filter ? { connectionId: filter } : {} })
    if (!res.ok) setError(res.error)
    else {
      const failed = res.data.results.find((r) => !r.ok)
      setNotice(failed ? `Some pages could not be read: ${failed.error}` : 'Up to date.')
    }
    await Promise.all([loadMeta(), loadList(view, filter)])
    setRefreshing(false)
  }

  async function afterSave(message: string) {
    setComposer(null)
    setNotice(message)
    await Promise.all([loadMeta(), loadList(view, filter)])
  }

  async function publishNow(post: Post) {
    setBusyId(post.id)
    const res = await api<{ post: Post }>(`/admin/posts/${post.id}/publish`, { method: 'POST' })
    setBusyId(null)
    if (!res.ok) setError(res.error)
    else setNotice(res.data.post.status === 'published' ? 'Posted.' : 'Some pages did not take the post. See the details below.')
    await Promise.all([loadMeta(), loadList(view, filter)])
  }

  async function remove(post: Post) {
    const ok = await askConfirm({
      title: 'Delete this post?',
      message: post.status === 'scheduled' ? 'It will not be posted.' : 'This only removes it from Social Hub. Anything already on a page stays there.',
    })
    if (!ok) return
    setBusyId(post.id)
    const res = await api<{ ok: true }>(`/admin/posts/${post.id}`, { method: 'DELETE' })
    setBusyId(null)
    if (!res.ok) setError(res.error)
    await Promise.all([loadMeta(), loadList(view, filter)])
  }

  async function removeRemote(post: RemotePost) {
    const network = PROVIDER_LABEL[post.provider]
    const ok = await askConfirm({
      title: `Delete this post from ${network}?`,
      message: `It will be removed from ${post.connectionName} for everyone, along with its reactions and comments. This cannot be undone.`,
    })
    if (!ok) return
    const key = `${post.connectionId}:${post.externalId}`
    setBusyId(key)
    const res = await api<{ outcome: 'deleted' | 'gone' }>('/admin/remote-posts', {
      method: 'DELETE',
      body: { connectionId: post.connectionId, externalId: post.externalId },
    })
    setBusyId(null)
    if (!res.ok) setError(res.error)
    else {
      setError('')
      setNotice(res.data.outcome === 'gone' ? `It was already gone from ${network}. Removed from this list.` : `Deleted from ${network}.`)
    }
    await Promise.all([loadMeta(), loadList(view, filter)])
  }

  const connections = meta?.connections ?? []
  const stale = connections.filter((c) => c.status === 'needs_reauth')
  const partial = connections.filter((c) => c.status === 'active' && c.readNotice)
  const counts = meta?.counts
  const attention = (counts?.failed ?? 0) + (counts?.partial ?? 0)
  const canPost = meta?.can.canPost ?? false
  const hasPages = connections.length > 0

  return (
    <div className="shub-page">
      <div className="shub-head">
        <div>
          <h1 className="shub-title">Social Hub</h1>
          <p className="shub-sub">Your Facebook and LinkedIn pages, in one place.</p>
        </div>
        <div className="shub-actions">
          {hasPages && canPost && (
            <button type="button" className="shub-pill shub-pill--icon" aria-label="Refresh from Facebook and LinkedIn" title="Refresh from Facebook and LinkedIn" disabled={refreshing} onClick={() => void refresh()}>
              <span className={refreshing ? 'shub-spin' : undefined} style={{ display: 'inline-flex' }}><Icon name="refresh" size={16} /></span>
            </button>
          )}
          {canPost && (
            <button type="button" className="shub-pill shub-pill--primary" disabled={!hasPages} onClick={() => setComposer({ editing: null })}>
              <Icon name="plus" size={15} /> New post
            </button>
          )}
        </div>
      </div>

      {error && <div className="shub-banner shub-banner--bad" role="alert"><Icon name="warn" size={16} /><span>{error}</span></div>}
      {notice && !error && (
        <div className="shub-banner shub-banner--ok" role="status">
          <Icon name="check" size={16} /><span style={{ flex: 1 }}>{notice}</span>
          <button type="button" className="shub-text-btn" style={{ color: 'inherit', fontSize: '0.8125rem' }} onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}
      {stale.length > 0 && (
        <div className="shub-banner" role="alert">
          <Icon name="warn" size={16} />
          <span>
            {stale.map((c) => c.name).join(', ')} {stale.length === 1 ? 'needs' : 'need'} reconnecting before {stale.length === 1 ? 'it' : 'they'} can be used.{' '}
            {meta?.can.canManage ? <a href={settingsHref}>Open settings</a> : 'Ask an admin to reconnect.'}
          </span>
        </div>
      )}

      {partial.map((c) => (
        <div className="shub-banner" role="alert" key={c.id}>
          <Icon name="warn" size={16} />
          <span><strong>{c.name}:</strong> {c.readNotice}{' '}{meta?.can.canManage && <a href={settingsHref}>Open settings</a>}</span>
        </div>
      ))}

      {meta && !hasPages ? (
        <div className="shub-group">
          <div className="shub-empty">
            <h3>Connect your first page</h3>
            <p>Link a Facebook Page or a LinkedIn Page and you can read what you have already posted, and write, schedule and publish new posts from here.</p>
            {meta.can.canManage
              ? <a className="shub-pill shub-pill--primary" href={settingsHref}>Set up Social Hub</a>
              : <p>Ask a site admin to connect a page in Settings.</p>}
          </div>
        </div>
      ) : (
        <>
          {hasPages && (
            <div className="shub-accounts" role="group" aria-label="Filter by page">
              <button type="button" className="shub-chip shub-chip--plain" aria-pressed={filter === null} onClick={() => setFilter(null)}>All pages</button>
              {connections.map((c) => (
                <button key={c.id} type="button" className="shub-chip" aria-pressed={filter === c.id} onClick={() => setFilter(filter === c.id ? null : c.id)}>
                  <Avatar name={c.name} pictureUrl={c.pictureUrl} provider={c.provider} />
                  <span className="shub-chip-name">{c.name}</span>
                  {c.status !== 'active' && <span className="shub-chip-warn" title="Needs reconnecting"><Icon name="warn" size={13} /></span>}
                </button>
              ))}
            </div>
          )}

          <div className="shub-toolbar">
            <div className="shub-seg" role="group" aria-label="Show">
              <button type="button" className="shub-seg-btn" aria-pressed={view === 'published'} onClick={() => setView('published')}>Published</button>
              <button type="button" className="shub-seg-btn" aria-pressed={view === 'scheduled'} onClick={() => setView('scheduled')}>
                Scheduled {!!counts?.scheduled && <span className="shub-seg-count">{counts.scheduled}</span>}
              </button>
              <button type="button" className="shub-seg-btn" aria-pressed={view === 'drafts'} onClick={() => setView('drafts')}>
                Drafts {!!counts?.draft && <span className="shub-seg-count">{counts.draft}</span>}
              </button>
              <button type="button" className="shub-seg-btn" aria-pressed={view === 'issues'} onClick={() => setView('issues')}>
                Needs attention {attention > 0 && <span className="shub-seg-count shub-seg-count--alert">{attention}</span>}
              </button>
            </div>
          </div>

          {loading && !meta ? (
            <><div className="shub-skeleton" /><div className="shub-skeleton" /></>
          ) : view === 'published' ? (
            feed.length === 0 && !loading ? (
              <div className="shub-group"><div className="shub-empty">
                <h3>Nothing to show yet</h3>
                <p>Posts already on your pages appear here after the first refresh. Press the refresh button to read them now.</p>
              </div></div>
            ) : (
              <Masonry>
                {feed.map((p) => <RemotePostRow
                  key={`${p.connectionId}:${p.externalId}`}
                  post={p}
                  connection={connections.find((c) => c.id === p.connectionId)}
                  busy={busyId === `${p.connectionId}:${p.externalId}`}
                  onDelete={canPost ? removeRemote : undefined}
                />)}
              </Masonry>
            )
          ) : local.length === 0 && !loading ? (
            <div className="shub-group"><div className="shub-empty">
              <h3>{view === 'scheduled' ? 'Nothing scheduled' : view === 'drafts' ? 'No drafts' : 'Everything went out'}</h3>
              <p>
                {view === 'scheduled'
                  ? 'Posts you schedule wait here until their time comes.'
                  : view === 'drafts'
                    ? 'Half-finished posts you save are kept here.'
                    : 'Posts that fail, in whole or in part, are listed here with the reason.'}
              </p>
            </div></div>
          ) : (
            <Masonry>
              {local.map((p) => (
                <LocalPostRow
                  key={p.id}
                  post={p}
                  connections={connections}
                  busy={busyId === p.id}
                  onEdit={(post) => setComposer({ editing: post })}
                  onPublish={(post) => void publishNow(post)}
                  onDelete={(post) => void remove(post)}
                />
              ))}
            </Masonry>
          )}
        </>
      )}

      {composer && (
        <Composer connections={connections} editing={composer.editing} onClose={() => setComposer(null)} onSaved={(m) => void afterSave(m)} />
      )}
      {confirmNode}
    </div>
  )
}
