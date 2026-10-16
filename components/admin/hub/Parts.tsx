'use client'

import { useState } from 'react'
import { proxiedImage } from '@/modules/social-hub/lib/urls'
import { PROVIDER_LABEL, type Provider } from '@/modules/social-hub/lib/types'
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
