'use client'

import { useState } from 'react'
import { useAdminConfirm } from '@/components/admin/useAdminConfirm'
import { PROVIDER_LABEL, type Connection, type Provider } from '@/modules/social-hub/lib/types'
import type { TestCallResult } from '@/modules/social-hub/lib/facebook-test-calls'
import { api } from '@/modules/social-hub/components/admin/hub/api'
import { Avatar, StatusPill } from '@/modules/social-hub/components/admin/hub/Parts'
import { relativeTime } from '@/modules/social-hub/components/admin/hub/format'
import type { AccountsView } from '@/modules/social-hub/components/admin/settings/types'

type Props = {
  accounts: AccountsView
  banner: { tone: 'ok' | 'bad'; text: string } | null
  onChanged: () => void
  goTo: (view: 'facebook' | 'linkedin') => void
}

function ConnectCard({ provider, connections, configured, onChanged, goTo }: {
  provider: Provider
  connections: Connection[]
  configured: boolean
  onChanged: () => void
  goTo: (view: 'facebook' | 'linkedin') => void
}) {
  const [askConfirm, confirmNode] = useAdminConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [testResults, setTestResults] = useState<Record<string, TestCallResult[]>>({})
  const label = PROVIDER_LABEL[provider]

  async function runTests(c: Connection) {
    const ok = await askConfirm({
      title: `Run Meta test calls on ${c.name}?`,
      message: 'This publishes a short test post on the page and deletes it again straight away, so it can be visible for a few seconds.',
      confirmLabel: 'Run test calls',
    })
    if (!ok) return
    setBusy(c.id)
    setError('')
    const res = await api<{ results: TestCallResult[] }>('/admin/test-calls', { method: 'POST', body: { connectionId: c.id } })
    setBusy(null)
    if (!res.ok) setError(res.error)
    else setTestResults((prev) => ({ ...prev, [c.id]: res.data.results }))
  }

  async function disconnect(c: Connection) {
    const ok = await askConfirm({
      title: `Disconnect ${c.name}?`,
      message: 'Scheduled posts for this page will fail until it is connected again. Nothing on the page itself is touched.',
      confirmLabel: 'Disconnect',
    })
    if (!ok) return
    setBusy(c.id)
    const res = await api<{ ok: true }>(`/admin/accounts/${c.id}`, { method: 'DELETE' })
    setBusy(null)
    if (!res.ok) setError(res.error)
    else onChanged()
  }

  return (
    <div className="card">
      <h3 className="card-title">{label} {connections.length > 0 && <StatusPill tone="ok">{connections.length} connected</StatusPill>}</h3>
      {error && <p className="field-error">{error}</p>}
      {connections.length === 0 && (
        <p className="shub-note" style={{ marginTop: 0 }}>
          {configured
            ? `No ${label} pages are connected yet. Press Connect, sign in, and choose the pages you want to use.`
            : `Before you can connect a ${label} page you need to create an app on ${label}'s developer site and paste its details in.`}
        </p>
      )}
      {connections.map((c) => (
        <div className="shub-acct-row" key={c.id}>
          <Avatar name={c.name} pictureUrl={c.pictureUrl} provider={c.provider} large />
          <div className="shub-acct-main">
            <div className="shub-acct-name">{c.name} {c.status === 'needs_reauth' && <StatusPill tone="warn">Needs reconnecting</StatusPill>}</div>
            <div className="shub-acct-meta">
              {c.lastError ? c.lastError : c.lastSyncedAt ? `Last read ${relativeTime(c.lastSyncedAt)}` : 'Not read yet'}
              {c.tokenExpiresAt && c.status === 'active' && ` · sign-in valid until ${new Date(c.tokenExpiresAt).toLocaleDateString()}`}
            </div>
            {c.readNotice && c.status === 'active' && (
              <div className="shub-acct-meta" role="alert" style={{ color: 'var(--color-warning-text, var(--color-text))', marginTop: '0.25rem' }}>
                <strong>Not everything is being read.</strong> {c.readNotice}
              </div>
            )}
          </div>
          {c.provider === 'facebook' && c.status === 'active' && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy === c.id} onClick={() => void runTests(c)}>Run Meta test calls</button>
          )}
          {c.profileUrl && <a className="btn btn-ghost btn-sm" href={c.profileUrl} target="_blank" rel="noreferrer noopener">Open</a>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy === c.id} onClick={() => void disconnect(c)}>Disconnect</button>
        </div>
      ))}
      {connections.map((c) => testResults[c.id] && (
        <div className="shub-note" key={`t-${c.id}`} role="status">
          <strong>Meta test calls for {c.name}</strong>
          <ul>
            {testResults[c.id]!.map((r) => (
              <li key={r.permission}>{r.ok ? '✓' : '✗'} <code>{r.permission}</code> - {r.what}. {r.detail}</li>
            ))}
            <li>Connecting a page makes the <code>pages_show_list</code> and <code>public_profile</code> calls, so press Reconnect to refresh those.</li>
          </ul>
        </div>
      ))}
      <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {configured ? (
          <a className="btn btn-primary" href={`/api/m/social-hub/oauth/${provider}/start`}>
            {connections.length > 0 ? `Reconnect or add ${label} pages` : `Connect ${label}`}
          </a>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => goTo(provider)}>Set up the {label} app first</button>
        )}
      </div>
      {confirmNode}
    </div>
  )
}

export function AccountsPanel({ accounts, banner, onChanged, goTo }: Props) {
  return (
    <div className="shub-set">
      {banner && <div className={`alert ${banner.tone === 'ok' ? 'alert-success' : 'alert-danger'}`} role="status">{banner.text}</div>}
      <div className="settings-cols">
        <ConnectCard provider="facebook" connections={accounts.connections.filter((c) => c.provider === 'facebook')} configured={accounts.configured.facebook} onChanged={onChanged} goTo={goTo} />
        <ConnectCard provider="linkedin" connections={accounts.connections.filter((c) => c.provider === 'linkedin')} configured={accounts.configured.linkedin} onChanged={onChanged} goTo={goTo} />
      </div>
    </div>
  )
}
