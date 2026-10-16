'use client'

import { useEffect, useRef, useState } from 'react'
import { proxiedImage } from '@/modules/social-hub/lib/urls'
import { PROVIDER_LABEL, type LinkPreview, type Provider } from '@/modules/social-hub/lib/types'
import { api } from '@/modules/social-hub/components/admin/hub/api'
import { hostOf } from '@/modules/social-hub/components/admin/hub/format'
import { Icon, ProviderGlyph } from '@/modules/social-hub/components/admin/hub/Glyphs'

export function Avatar({ name, pictureUrl, provider, large }: { name: string; pictureUrl: string | null; provider: Provider; large?: boolean }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className={`shub-avatar${large ? ' shub-avatar--lg' : ''}`} title={`${name} on ${PROVIDER_LABEL[provider]}`}>
      {pictureUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- a proxied remote picture; next/image would need the host allow-listed
        <img src={proxiedImage(pictureUrl)} alt="" onError={() => setBroken(true)} />
      ) : (
        (name.trim().charAt(0) || '?').toUpperCase()
      )}
      <span className="shub-avatar-badge"><ProviderGlyph provider={provider} size={9} /></span>
    </span>
  )
}

export function MediaGrid({ urls, proxy = true }: { urls: string[]; proxy?: boolean }) {
  const shown = urls.slice(0, 4)
  if (shown.length === 0) return null
  return (
    <div className={`shub-media shub-media--${shown.length}`}>
      {shown.map((u) => (
        // eslint-disable-next-line @next/next/no-img-element -- proxied remote pictures
        <img key={u} src={proxy ? proxiedImage(u) : u} alt="" loading="lazy" />
      ))}
    </div>
  )
}

export function LinkCard({ url, title, description, imageUrl }: { url: string; title: string | null; description?: string | null; imageUrl?: string | null }) {
  return (
    <a className="shub-linkcard" href={url} target="_blank" rel="noreferrer noopener">
      {imageUrl && (
        <span className="shub-linkcard-img">
          {/* eslint-disable-next-line @next/next/no-img-element -- proxied remote picture */}
          <img src={proxiedImage(imageUrl)} alt="" loading="lazy" />
        </span>
      )}
      <span className="shub-linkcard-body">
        <span className="shub-linkcard-host">{hostOf(url)}</span>
        <span className="shub-linkcard-title">{title || url}</span>
        {description && <span className="shub-linkcard-desc">{description}</span>}
      </span>
    </a>
  )
}

// A page's title is looked up once per address for the whole screen, however many cards share it.
const previewCache = new Map<string, Promise<LinkPreview | null>>()

function lookUpPreview(url: string): Promise<LinkPreview | null> {
  let found = previewCache.get(url)
  if (!found) {
    found = api<{ preview: LinkPreview }>('/admin/link-preview', { method: 'POST', body: { url } }).then((res) => (res.ok ? res.data.preview : null))
    previewCache.set(url, found)
  }
  return found
}

/**
 * The link a published post shares, as a clickable card carrying the page's title. The
 * network does not always say what the page is called, so a missing title is read from the
 * page itself; until it arrives (or if it never does) the card shows the address.
 */
export function RemoteLinkCard({ url, title, imageUrl }: { url: string; title: string | null; imageUrl?: string | null }) {
  const [found, setFound] = useState<{ url: string; preview: LinkPreview } | null>(null)
  useEffect(() => {
    if (title) return
    let live = true
    void lookUpPreview(url).then((preview) => { if (live && preview) setFound({ url, preview }) })
    return () => { live = false }
  }, [url, title])
  const preview = found?.url === url ? found.preview : null
  return (
    <LinkCard
      url={url}
      title={title ?? preview?.title ?? null}
      description={title ? null : preview?.description}
      imageUrl={imageUrl ?? preview?.imageUrl ?? null}
    />
  )
}

/** The three-dots button on a post card, and the little menu it opens. */
export type PostMenuItem = {
  label: string
  icon: 'external' | 'edit' | 'trash'
  /** Opens in a new tab when given. */
  href?: string
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
}

export function PostMenu({ items, label = 'Post options' }: { items: PostMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  if (items.length === 0) return null
  return (
    <div className="shub-menu" ref={root}>
      <button type="button" className="shub-menu-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div className="shub-menu-list" role="menu">
          {items.map((item) => {
            const cls = `shub-menu-item${item.danger ? ' shub-menu-item--danger' : ''}`
            const inner = <><Icon name={item.icon} size={15} /> {item.label}</>
            return item.href ? (
              <a key={item.label} className={cls} role="menuitem" href={item.href} target="_blank" rel="noreferrer noopener" onClick={() => setOpen(false)}>{inner}</a>
            ) : (
              <button key={item.label} type="button" className={cls} role="menuitem" disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect?.() }}>{inner}</button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Post text that folds long posts down to five lines with a "Show more". */
export function PostText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = text.length > 280 || text.split('\n').length > 5
  return (
    <>
      <p className={`shub-post-text${long && !open ? ' shub-post-text--clamped' : ''}`}>{text}</p>
      {long && (
        <button type="button" className="shub-more" onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}

export function StatusPill({ tone, children }: { tone?: 'ok' | 'warn' | 'bad' | 'info'; children: React.ReactNode }) {
  return <span className={`shub-status${tone ? ` shub-status--${tone}` : ''}`}>{children}</span>
}

export function ViewLink({ href, provider }: { href: string | null; provider: Provider }) {
  if (!href) return null
  return (
    <a className="shub-link" href={href} target="_blank" rel="noreferrer noopener">
      View on {PROVIDER_LABEL[provider]} <Icon name="external" size={13} />
    </a>
  )
}
