'use client'

import { useEffect, useRef, useState } from 'react'
import type { PostImage } from '@/modules/social-hub/lib/types'
import { Icon } from '@/modules/social-hub/components/admin/hub/Glyphs'

type MediaItem = { id: string; url: string; altText: string | null; originalName: string | null; mimeType: string }

/**
 * Pick pictures from the site's media library, or upload new ones into it.
 * Posts use library pictures so the network can fetch them from a public address.
 */
export function MediaSheet({ max, onDone, onClose }: { max: number; onDone: (images: PostImage[]) => void; onClose: () => void }) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<MediaItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ perPage: '60', type: 'image', folder: 'all' })
      if (query.trim()) params.set('q', query.trim())
      try {
        const res = await fetch(`/api/admin/media?${params.toString()}`)
        const data = (await res.json()) as { items?: MediaItem[] }
        if (!cancelled) setItems((data.items ?? []).filter((i) => /^image\/(jpeg|png|webp|gif)$/i.test(i.mimeType)))
      } catch {
        if (!cancelled) setError('Could not load the media library.')
      }
      if (!cancelled) setLoading(false)
    }, query ? 250 : 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  function toggle(item: MediaItem) {
    setPicked((cur) => {
      if (cur.some((p) => p.id === item.id)) return cur.filter((p) => p.id !== item.id)
      return cur.length >= max ? cur : [...cur, item]
    })
  }

  async function upload(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('altText', '')
    try {
      const res = await fetch('/api/admin/media', { method: 'POST', body: fd })
      const record = (await res.json()) as MediaItem & { error?: string }
      if (!res.ok) throw new Error(record.error ?? 'Upload failed')
      setItems((cur) => [record, ...cur])
      setPicked((cur) => (cur.length >= max ? cur : [...cur, record]))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="shub-overlay" style={{ zIndex: 10001 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="shub-sheet shub-sheet--wide" role="dialog" aria-modal="true" aria-label="Choose pictures">
        <div className="shub-sheet-head">
          <button type="button" className="shub-text-btn" onClick={onClose}>Cancel</button>
          <span className="shub-sheet-title">Choose pictures</span>
          <button type="button" className="shub-text-btn" disabled={picked.length === 0}
            onClick={() => onDone(picked.map((p) => ({ url: p.url, ...(p.altText ? { alt: p.altText } : {}) })))}>
            Add{picked.length ? ` (${picked.length})` : ''}
          </button>
        </div>
        <div className="shub-sheet-body">
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input className="shub-input" placeholder="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} />
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => upload(e.target.files)} />
            <button type="button" className="shub-pill" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size={14} /> {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
          {error && <p className="shub-error">{error}</p>}
          {loading && <p className="shub-hint">Loading…</p>}
          {!loading && items.length === 0 && <p className="shub-hint">No pictures found. Upload one to get started.</p>}
          <div className="shub-picker">
            {items.map((item) => {
              const on = picked.some((p) => p.id === item.id)
              return (
                <button key={item.id} type="button" className="shub-pick" aria-pressed={on} onClick={() => toggle(item)} title={item.originalName ?? ''}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- library pictures, sized by the grid */}
                  <img src={item.url} alt={item.altText ?? ''} loading="lazy" />
                  {on && <span className="shub-pick-tick"><Icon name="check" size={12} /></span>}
                </button>
              )
            })}
          </div>
          <p className="shub-hint">Up to {max} pictures. JPEG, PNG, WebP or GIF.</p>
        </div>
      </div>
    </div>
  )
}
