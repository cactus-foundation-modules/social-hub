'use client'

import { useState } from 'react'
import { LIMITS, PROVIDER_LABEL, type RemotePost } from '@/modules/social-hub/lib/types'
import { api } from '@/modules/social-hub/components/admin/hub/api'

/** Rewrite the words of a post that is already live. Facebook lets the text change, nothing else. */
export function EditRemoteSheet({ post, onClose, onSaved }: { post: RemotePost; onClose: () => void; onSaved: (message: string) => void }) {
  const [text, setText] = useState(post.message)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const network = PROVIDER_LABEL[post.provider]
  const len = text.length
  const countClass = len > LIMITS.bodyMax ? 'shub-count shub-count--bad' : len > LIMITS.bodyMax * 0.9 ? 'shub-count shub-count--warn' : 'shub-count'
  const unchanged = text.trim() === post.message.trim()

  async function save() {
    setError('')
    setBusy(true)
    const res = await api<{ ok: true }>('/admin/remote-posts', {
      method: 'PATCH',
      body: { connectionId: post.connectionId, externalId: post.externalId, message: text },
    })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    onSaved(`Updated on ${network}.`)
  }

  return (
    <div className="shub-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="shub-sheet" role="dialog" aria-modal="true" aria-label="Edit post">
        <div className="shub-sheet-head">
          <button type="button" className="shub-text-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <span className="shub-sheet-title">Edit post</span>
          <button type="button" className="shub-pill shub-pill--primary shub-pill--small" disabled={busy || unchanged || !text.trim() || len > LIMITS.bodyMax} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div className="shub-sheet-body">
          <div>
            <span className="shub-label">On {post.connectionName}</span>
            <div className="shub-editor">
              <textarea className="shub-textarea" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} autoFocus aria-label="Post text" />
              <div className="shub-editor-foot">
                <span />
                <span className={countClass}>{len} / {LIMITS.bodyMax}</span>
              </div>
            </div>
            <p className="shub-hint" style={{ marginTop: '0.5rem' }}>
              Only the words can be changed. {network} does not let the pictures or the link on a live post be swapped; to change those, delete the post and write it again.
            </p>
          </div>
          {error && <p className="shub-error" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  )
}
