'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useAdminPath } from '@/components/admin/AdminPathContext'
import { LIMITS, PROVIDER_LABEL, type Connection, type Post } from '@/modules/social-hub/lib/types'
import { api } from '@/modules/social-hub/components/admin/hub/api'
import { fullDateTime, toLocalInput } from '@/modules/social-hub/components/admin/hub/format'

// A card in Gazette's post editor (`gazette.post-editor-panels`): tick Facebook
// and/or LinkedIn, write the post, and it goes out when the article is published
// or at the article's scheduled time. Gazette keeps us told about the article by
// window events; the names and shapes are our copy of its contract, declared here
// because Social Hub must build on a site with no Gazette.

type Article = {
  id: string
  title: string
  excerpt: string | null
  url: string
  imageUrl: string | null
  status: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED'
  liveAt: string | null
  isPrivate: boolean
}

type BeforePublish = { action: 'publish' | 'schedule'; liveAt: string | null; waitFor: (work: Promise<unknown>) => void }

const STATE_EVENT = 'gazette:post-editor-state'
const BEFORE_PUBLISH_EVENT = 'gazette:post-editor-before-publish'
const SAVE_DEBOUNCE_MS = 1000

type Linked = Post & { sourceAt: string | null }
type Loaded = { connections: Connection[]; post: Linked | null; canPost: boolean }

const UNSENT = new Set(['draft', 'scheduled', 'failed'])

function defaultText(a: Article): string {
  return [a.title, a.excerpt].filter(Boolean).join('\n\n')
}

const hint = { fontSize: '0.75rem', color: 'var(--color-text-secondary)' } as const

export function GazetteSharePanel({ post: initial }: { post: Article }) {
  const adminPath = useAdminPath()
  const [article, setArticle] = useState<Article>(initial)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  const [ticked, setTicked] = useState<string[]>([])
  const [body, setBody] = useState('')
  const [ownTime, setOwnTime] = useState(false)
  const [when, setWhen] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The latest of everything a save needs, for the before-publish handler and the timer.
  const latest = useRef({ article, ticked, body, ownTime, when, dirty })
  useLayoutEffect(() => { latest.current = { article, ticked, body, ownTime, when, dirty } })

  const adopt = useCallback((data: Loaded) => {
    setLoaded(data)
    const p = data.post
    if (p) {
      setTicked(p.targets.map((t) => t.connectionId))
      setBody(p.body)
      setOwnTime(!!p.sourceAt)
      setWhen(p.sourceAt ? toLocalInput(new Date(p.sourceAt)) : '')
    }
    setDirty(false)
  }, [])

  const load = useCallback(async () => {
    const res = await api<Loaded>(`/admin/gazette-share/${initial.id}`)
    if (!res.ok) { setError(res.error); return }
    setError('')
    adopt(res.data)
  }, [initial.id, adopt])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set after the response, never synchronously
  useEffect(() => { void load() }, [load])

  /** Save now. Rejects with a plain-English message when the post cannot be kept as it is. */
  const save = useCallback(async (go = false): Promise<void> => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
    const cur = latest.current
    const a = cur.article
    const sourceAt = cur.ownTime && cur.when ? new Date(cur.when).toISOString() : null
    if (cur.ticked.length > 0 && cur.ownTime && !cur.when) throw new Error('Pick a time for the social post, or choose "When the article goes live".')
    setSaving(true)
    const res = await api<{ post: Linked | null }>(`/admin/gazette-share/${a.id}`, {
      method: 'PUT',
      body: {
        article: { title: a.title, excerpt: a.excerpt, url: a.url, imageUrl: a.imageUrl, status: a.status, liveAt: a.liveAt, isPrivate: a.isPrivate },
        body: cur.body,
        connectionIds: cur.ticked,
        sourceAt,
        go,
      },
    })
    setSaving(false)
    if (!res.ok) { setError(res.error); throw new Error(`Social post: ${res.error}`) }
    setError('')
    setDirty(false)
    setLoaded((l) => (l ? { ...l, post: res.data.post } : l))
  }, [])

  const queueSave = useCallback(() => {
    setDirty(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { save().catch(() => undefined) }, SAVE_DEBOUNCE_MS)
  }, [save])

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  // Follow the article as it is edited, and refresh once it is published or
  // scheduled: Gazette has armed (or stood down) the social post by then.
  useEffect(() => {
    function onState(e: Event) {
      const next = (e as CustomEvent<Article>).detail
      if (!next || next.id !== initial.id) return
      setArticle((prev) => {
        if (prev.status !== next.status || prev.liveAt !== next.liveAt || prev.isPrivate !== next.isPrivate) void load()
        return next
      })
    }
    function onBeforePublish(e: Event) {
      const detail = (e as CustomEvent<BeforePublish>).detail
      // Nothing waiting to be saved means nothing to hold the publish up for.
      if (!detail || (!latest.current.dirty && !debounceRef.current)) return
      detail.waitFor(save())
    }
    window.addEventListener(STATE_EVENT, onState)
    window.addEventListener(BEFORE_PUBLISH_EVENT, onBeforePublish)
    return () => {
      window.removeEventListener(STATE_EVENT, onState)
      window.removeEventListener(BEFORE_PUBLISH_EVENT, onBeforePublish)
    }
  }, [initial.id, load, save])

  function toggle(id: string, on: boolean) {
    const next = on ? [...ticked, id] : ticked.filter((t) => t !== id)
    setTicked(next)
    if (on && ticked.length === 0 && !body.trim()) setBody(defaultText(article))
    queueSave()
  }

  async function goNow() {
    setBusy(true)
    try { await save(true) } catch { /* message already shown */ }
    setBusy(false)
  }

  async function retry(postId: string) {
    setBusy(true)
    const res = await api<{ post: Post }>(`/admin/posts/${postId}/publish`, { method: 'POST' })
    if (!res.ok) setError(res.error)
    await load()
    setBusy(false)
  }

  const card = (children: ReactNode) => (
    <div className="card" style={{ padding: '1rem' }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9375rem' }}>Share on social media</h3>
      {error && <div className="alert alert-danger" role="alert" style={{ fontSize: '0.75rem' }}>{error}</div>}
      {children}
    </div>
  )

  if (!loaded) return card(<p style={hint}>{error ? '' : 'Loading…'}</p>)

  const { connections, post, canPost } = loaded
  if (connections.length === 0) {
    return card(
      <p style={hint}>
        Connect a Facebook or LinkedIn page in <a href={`/${adminPath}/m/social-hub`}>Social Hub</a> first, and this post can go out there too.
      </p>,
    )
  }

  // Gone, or going: show where it landed rather than an editor.
  if (post && !UNSENT.has(post.status)) {
    return card(
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {post.targets.map((t) => (
          <div key={t.id} style={{ fontSize: '0.8125rem' }}>
            <span className={`badge ${t.status === 'published' ? 'badge-success' : t.status === 'failed' ? 'badge-danger' : 'badge-info'}`}>
              {t.status === 'published' ? 'Posted' : t.status === 'failed' ? 'Failed' : 'Posting'}
            </span>{' '}
            {PROVIDER_LABEL[t.provider]} · {t.connectionName}
            {t.permalink && <> · <a href={t.permalink} target="_blank" rel="noopener noreferrer">View</a></>}
            {t.error && <div style={hint}>{t.error}</div>}
          </div>
        ))}
        {post.publishedAt && <div style={hint}>Went out {fullDateTime(post.publishedAt)}</div>}
        {canPost && post.status === 'partial' && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => retry(post.id)}>Try the failed ones again</button>
        )}
      </div>,
    )
  }

  const editable = canPost
  const live = article.status === 'PUBLISHED'
  const armed = post?.status === 'scheduled'
  const over = body.length > LIMITS.bodyMax

  let state: ReactNode = null
  if (ticked.length > 0) {
    if (article.isPrivate) state = <div className="alert alert-warning" style={{ fontSize: '0.75rem', margin: 0 }}>Private posts are not shared: there is nothing public to link to.</div>
    else if (post?.status === 'failed') state = <div style={hint}>The last attempt failed{post.targets.find((t) => t.error)?.error ? `: ${post.targets.find((t) => t.error)?.error}` : '.'}</div>
    else if (armed && post?.scheduledAt) state = <div style={hint}>Goes out {fullDateTime(post.scheduledAt)}.</div>
    else if (!live) state = <div style={hint}>Goes out when you publish or schedule this post.</div>
    else state = <div style={hint}>This post is already live, so the social post goes when you say.</div>
  }

  return card(
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <div style={hint}>Also post to</div>
        {connections.map((c) => (
          <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}>
            <input
              type="checkbox"
              checked={ticked.includes(c.id)}
              disabled={!editable || (c.status !== 'active' && !ticked.includes(c.id))}
              onChange={(e) => toggle(c.id, e.target.checked)}
            />
            <span>
              {PROVIDER_LABEL[c.provider]} · {c.name}
              {c.status !== 'active' && <span style={{ ...hint, display: 'block' }}>Needs reconnecting in Social Hub</span>}
            </span>
          </label>
        ))}
      </div>

      {ticked.length > 0 && (
        <>
          <div>
            <textarea
              value={body}
              onChange={(e) => { setBody(e.target.value); queueSave() }}
              disabled={!editable}
              rows={6}
              aria-label="Social post text"
              style={{ width: '100%', padding: '0.5rem', border: `1px solid ${over ? 'var(--color-danger)' : 'var(--color-border)'}`, borderRadius: 6, fontSize: '0.8125rem', fontFamily: 'inherit', background: 'var(--color-bg)', color: 'var(--color-text)', resize: 'vertical' }}
            />
            <div style={{ ...hint, display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
              <span>A link to this post is added for you.</span>
              <span style={over ? { color: 'var(--color-danger)' } : undefined}>{body.length}/{LIMITS.bodyMax}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', fontSize: '0.8125rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="radio" name={`shub-when-${article.id}`} checked={!ownTime} disabled={!editable} onChange={() => { setOwnTime(false); queueSave() }} />
              {live ? 'Straight away' : 'When the article goes live'}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="radio" name={`shub-when-${article.id}`} checked={ownTime} disabled={!editable} onChange={() => { setOwnTime(true); queueSave() }} />
              At a set time
            </label>
            {ownTime && (
              <input
                type="datetime-local"
                value={when}
                disabled={!editable}
                onChange={(e) => { setWhen(e.target.value); queueSave() }}
                style={{ padding: '0.25rem', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: '0.75rem', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              />
            )}
            {ownTime && !live && <div style={hint}>Never before the article itself goes live.</div>}
          </div>

          {state}

          {editable && live && !article.isPrivate && !armed && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || saving || over} onClick={goNow}>
              {ownTime ? 'Schedule social post' : 'Post now'}
            </button>
          )}
          <div style={hint}>{saving ? 'Saving…' : dirty ? 'Unsaved changes' : post ? 'Saved' : ''}</div>
        </>
      )}
      {!editable && <div style={hint}>You can see this, but posting needs Social Hub posting permission.</div>}
    </div>,
  )
}
