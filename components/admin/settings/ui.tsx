'use client'

import { useState, type ReactNode } from 'react'

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="shub-steps">{children}</ol>
}

/** A read-only value with a Copy button - for addresses the owner has to paste into somebody else's website. */
export function CopyField({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="field field--wide">
      <label>{label}</label>
      <div className="shub-copy">
        <span className="shub-code">{value ?? 'Your site address is not set (SITE_URL).'}</span>
        <button type="button" className="btn btn-secondary" disabled={!value} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return <span className="shub-code">{children}</span>
}

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
}
