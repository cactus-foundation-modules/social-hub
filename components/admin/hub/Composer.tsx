'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LIMITS, PROVIDER_LABEL, type Connection, type LinkPreview, type Post, type PostImage, type PostMode, type Provider } from '@/modules/social-hub/lib/types'
import { firstUrl } from '@/modules/social-hub/lib/urls'
import { api } from '@/modules/social-hub/components/admin/hub/api'
import { Avatar, LinkCard, MediaGrid, PostText } from '@/modules/social-hub/components/admin/hub/Parts'
import { MediaSheet } from '@/modules/social-hub/components/admin/hub/MediaSheet'
import { Icon } from '@/modules/social-hub/components/admin/hub/Glyphs'
import { timeZoneName, toLocalInput } from '@/modules/social-hub/components/admin/hub/format'

type Props = {
  connections: Connection[]
  editing: Post | null
  /**
   * Start a new post from something that already exists elsewhere: the words, the
   * address to attach as a link card, and which network's pages to tick.
   */
  prefill?: { text: string; linkUrl: string; provider: Provider }
  /** Called after a save that should refresh the lists. `message` is shown as a notice. */
  onSaved: (message: string) => void
  onClose: () => void
}

function nineAm(daysAhead: number, weekday?: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  if (weekday !== undefined) while (d.getDay() !== weekday) d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}

export function Composer({ connections, editing, prefill, onSaved, onClose }: Props) {
  const usable = useMemo(() => connections.filter((c) => c.status === 'active'), [connections])
  const [text, setText] = useState(editing?.body ?? prefill?.text ?? '')
  const [images, setImages] = useState<PostImage[]>(editing?.images ?? [])
  const [chosen, setChosen] = useState<string[]>(
    editing
      ? editing.targets.map((t) => t.connectionId)
      : prefill
        ? usable.filter((c) => c.provider === prefill.provider).map((c) => c.id)
        : usable.length === 1 ? [usable[0]!.id] : [],
  )
  const [link, setLink] = useState<LinkPreview | null>(
    editing?.linkUrl
      ? { url: editing.linkUrl, title: editing.linkTitle, description: editing.linkDescription, imageUrl: editing.linkImageUrl, siteName: null }
      : prefill
        ? { url: prefill.linkUrl, title: null, description: null, imageUrl: null, siteName: null }
        : null,
  )
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [linkBox, setLinkBox] = useState(false)
  const dismissed = useRef<Set<string>>(new Set())
  const [mode, setMode] = useState<PostMode>(editing?.status === 'scheduled' ? 'schedule' : 'now')
  const [when, setWhen] = useState(editing?.scheduledAt ? toLocalInput(new Date(editing.scheduledAt)) : toLocalInput(nineAm(1)))
  const [showMedia, setShowMedia] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [previewOf, setPreviewOf] = useState<Provider | null>(null)

  const loadPreview = useCallback(async (url: string) => {
    setLinkLoading(true)
    const res = await api<{ preview: LinkPreview }>('/admin/link-preview', { method: 'POST', body: { url } })
    setLinkLoading(false)
    if (res.ok) setLink(res.data.preview)
    else setLink({ url, title: null, description: null, imageUrl: null, siteName: null })
  }, [])

  // A prefilled address gets its picture and description the same way a pasted one does.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open; state is set after the response, never synchronously
    if (prefill) void loadPreview(prefill.linkUrl)
  }, [prefill, loadPreview])

  // A link typed into the text turns into a preview card, once, unless it has been dismissed.
  useEffect(() => {
    if (link || linkLoading) return
    const found = firstUrl(text)
    if (!found || dismissed.current.has(found)) return
    const timer = setTimeout(() => { void loadPreview(found) }, 700)
    return () => clearTimeout(timer)
  }, [text, link, linkLoading, loadPreview])

  const selected = connections.filter((c) => chosen.includes(c.id))
  const providers = [...new Set(selected.map((c) => c.provider))]
  const activePreview: Provider | null = previewOf && providers.includes(previewOf) ? previewOf : providers[0] ?? null
  const len = text.length
  const countClass = len > LIMITS.bodyMax ? 'shub-count shub-count--bad' : len > LIMITS.bodyMax * 0.9 ? 'shub-count shub-count--warn' : 'shub-count'

  function toggle(id: string) {
    setChosen((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]))
  }

  function removeLink() {
    if (link) dismissed.current.add(link.url)
    setLink(null)
  }

  async function addTypedLink() {
    const url = linkDraft.trim()
    if (!/^https?:\/\//i.test(url)) { setError('Start the link with http:// or https://'); return }
    setError('')
    setLinkBox(false)
    setLinkDraft('')
    await loadPreview(url)
  }

  async function submit(chosenMode: PostMode) {
    setError('')
    setBusy(true)
    const scheduledAt = chosenMode === 'schedule' ? new Date(when).toISOString() : null
    const body = {
      body: text,
      linkUrl: link?.url ?? null,
      linkTitle: link?.title ?? null,
      linkDescription: link?.description ?? null,
      linkImageUrl: link?.imageUrl ?? null,
      images,
      connectionIds: chosen,
      mode: chosenMode,
      scheduledAt,
    }
    const res = editing
      ? await api<{ post: Post; outcome?: { ok: boolean; status?: string } }>(`/admin/posts/${editing.id}`, { method: 'PATCH', body })
      : await api<{ post: Post; outcome?: { ok: boolean; status?: string } }>('/admin/posts', { method: 'POST', body })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    if (chosenMode === 'draft') onSaved('Draft saved.')
    else if (chosenMode === 'schedule') onSaved('Post scheduled.')
    else {
      const status = res.data.post.status
      onSaved(status === 'published' ? 'Posted.' : status === 'partial' ? 'Posted to some pages. Check the ones that failed.' : 'The post did not go out. See what went wrong under Needs attention.')
    }
  }

  const actionLabel = mode === 'now' ? 'Post' : mode === 'schedule' ? 'Schedule' : 'Save'
  const hasContent = text.trim().length > 0 || !!link || images.length > 0

  return (
    <div className="shub-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="shub-sheet" role="dialog" aria-modal="true" aria-label={editing ? 'Edit post' : 'New post'}>
        <div className="shub-sheet-head">
          <button type="button" className="shub-text-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <span className="shub-sheet-title">{editing ? 'Edit post' : 'New post'}</span>
          <button type="button" className="shub-pill shub-pill--primary shub-pill--small" disabled={busy || len > LIMITS.bodyMax || (mode !== 'draft' && !hasContent)} onClick={() => submit(mode)}>
            {busy ? 'Working…' : actionLabel}
          </button>
        </div>

        <div className="shub-sheet-body">
          <div>
            <span className="shub-label">Post to</span>
            {connections.length === 0 ? (
              <p className="shub-hint">No pages are connected yet. Connect one in Settings → Social Hub.</p>
            ) : (
              <div className="shub-pages">
                {connections.map((c) => (
                  <button key={c.id} type="button" className="shub-chip" aria-pressed={chosen.includes(c.id)} disabled={c.status !== 'active'} onClick={() => toggle(c.id)}
                    title={c.status !== 'active' ? 'Needs reconnecting in Settings → Social Hub' : undefined}>
                    <Avatar name={c.name} pictureUrl={c.pictureUrl} provider={c.provider} />
                    <span className="shub-chip-name">{c.name}</span>
                    {chosen.includes(c.id) && <Icon name="check" size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="shub-editor">
            <textarea className="shub-textarea" placeholder="What do you want to share?" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <div className="shub-editor-foot">
              <div className="shub-tools">
                <button type="button" className="shub-tool" disabled={images.length >= LIMITS.imagesMax} onClick={() => setShowMedia(true)}><Icon name="image" size={15} /> Photo</button>
                <button type="button" className="shub-tool" disabled={!!link} onClick={() => setLinkBox((v) => !v)}><Icon name="link" size={15} /> Link</button>
              </div>
              <span className={countClass}>{len} / {LIMITS.bodyMax}</span>
            </div>
          </div>

          {linkBox && !link && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input className="shub-input" placeholder="https://example.com/page" value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addTypedLink() } }} autoFocus />
              <button type="button" className="shub-pill" onClick={() => void addTypedLink()}>Add</button>
            </div>
          )}

          {linkLoading && <p className="shub-linkload">Fetching a preview of the link…</p>}
          {link && (
            <div className="shub-linkbox">
              <LinkCard url={link.url} title={link.title} description={link.description} imageUrl={link.imageUrl} />
              <button type="button" className="shub-x" aria-label="Remove link" onClick={removeLink}><Icon name="close" size={12} /></button>
            </div>
          )}

          {images.length > 0 && (
            <div className="shub-thumbs">
              {images.map((img, i) => (
                <div key={`${img.url}-${i}`} className="shub-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element -- library picture thumbnail */}
                  <img src={img.url} alt={img.alt ?? ''} />
                  <button type="button" className="shub-x" aria-label="Remove picture" onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button>
                </div>
              ))}
            </div>
          )}
          {images.length > 0 && link && <p className="shub-hint">With pictures attached, the link goes into the text of the post instead of a preview card.</p>}

          <div className="shub-when">
            <span className="shub-label">When</span>
            <div className="shub-seg" role="group" aria-label="When to post">
              {(['now', 'schedule', 'draft'] as const).map((m) => (
                <button key={m} type="button" className="shub-seg-btn" aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {m === 'now' ? 'Post now' : m === 'schedule' ? 'Schedule' : 'Save as draft'}
                </button>
              ))}
            </div>
            {mode === 'schedule' && (
              <>
                <input className="shub-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ maxWidth: '16rem' }} />
                <div className="shub-quick">
                  <button type="button" className="shub-pill shub-pill--small" onClick={() => setWhen(toLocalInput(new Date(Date.now() + 3_600_000)))}>In an hour</button>
                  <button type="button" className="shub-pill shub-pill--small" onClick={() => setWhen(toLocalInput(nineAm(1)))}>Tomorrow 9am</button>
                  <button type="button" className="shub-pill shub-pill--small" onClick={() => setWhen(toLocalInput(nineAm(1, 1)))}>Monday 9am</button>
                </div>
                <p className="shub-hint">
                  Times are in {timeZoneName()}. A scheduled post goes out on or after this time, at the next check
                  (every few minutes on most sites).
                </p>
              </>
            )}
          </div>

          {activePreview && hasContent && (
            <div>
              <span className="shub-label">Preview</span>
              {providers.length > 1 && (
                <div className="shub-seg" style={{ marginBottom: '0.6rem' }}>
                  {providers.map((p) => (
                    <button key={p} type="button" className="shub-seg-btn" aria-pressed={activePreview === p} onClick={() => setPreviewOf(p)}>{PROVIDER_LABEL[p]}</button>
                  ))}
                </div>
              )}
              <div className="shub-preview">
                <div className="shub-post-head">
                  {(() => {
                    const c = selected.find((s) => s.provider === activePreview)!
                    return (
                      <>
                        <Avatar name={c.name} pictureUrl={c.pictureUrl} provider={c.provider} />
                        <div className="shub-post-who"><div className="shub-post-name">{c.name}</div><div className="shub-post-when">Just now · {PROVIDER_LABEL[c.provider]}</div></div>
                      </>
                    )
                  })()}
                </div>
                <PostText text={text} />
                <MediaGrid urls={images.map((i) => i.url)} proxy={false} />
                {link && images.length === 0 && <LinkCard url={link.url} title={link.title} description={link.description} imageUrl={link.imageUrl} />}
              </div>
            </div>
          )}

          {error && <p className="shub-error" role="alert">{error}</p>}
        </div>
      </div>

      {showMedia && (
        <MediaSheet
          max={LIMITS.imagesMax - images.length}
          onClose={() => setShowMedia(false)}
          onDone={(picked) => { setImages((cur) => [...cur, ...picked].slice(0, LIMITS.imagesMax)); setShowMedia(false) }}
        />
      )}
    </div>
  )
}
