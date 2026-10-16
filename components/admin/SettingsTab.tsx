'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsHeaderActions, SettingsHeaderStatus } from '@/components/admin/SettingsHeaderActions'
import { TabStrip } from '@/components/admin/TabStrip'
import { useTabParam } from '@/components/admin/useTabParam'
import { api } from '@/modules/social-hub/components/admin/hub/api'
import { AccountsPanel } from '@/modules/social-hub/components/admin/settings/AccountsPanel'
import { FacebookPanel } from '@/modules/social-hub/components/admin/settings/FacebookPanel'
import { HelpPanel } from '@/modules/social-hub/components/admin/settings/HelpPanel'
import { LinkedInPanel } from '@/modules/social-hub/components/admin/settings/LinkedInPanel'
import { PublishingPanel } from '@/modules/social-hub/components/admin/settings/PublishingPanel'
import type { AccountsView, Credentials, SettingsView } from '@/modules/social-hub/components/admin/settings/types'
import '@/modules/social-hub/components/admin/hub/hub.css'

const VIEWS = ['accounts', 'facebook', 'linkedin', 'publishing', 'help'] as const
type View = (typeof VIEWS)[number]

const LABELS: Record<View, string> = {
  accounts: 'Accounts',
  facebook: 'Facebook setup',
  linkedin: 'LinkedIn setup',
  publishing: 'Publishing',
  help: 'Help',
}

const BLANK: Credentials = { fbAppId: '', fbAppSecret: '', fbConfigId: '', liClientId: '', liClientSecret: '' }

function draftOf(s: SettingsView): Credentials {
  return { fbAppId: s.fbAppId, fbAppSecret: '', fbConfigId: s.fbConfigId, liClientId: s.liClientId, liClientSecret: '' }
}

export function SocialHubSettingsTab() {
  const [view, setView] = useTabParam<View>('view', 'accounts', VIEWS)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [accounts, setAccounts] = useState<AccountsView | null>(null)
  const [draft, setDraft] = useState<Credentials>(BLANK)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const [banner, setBanner] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const loadAccounts = useCallback(async () => {
    const res = await api<AccountsView>('/admin/accounts')
    if (res.ok) setAccounts(res.data)
    else setError(res.error)
  }, [])

  const loadSettings = useCallback(async () => {
    const res = await api<SettingsView>('/admin/settings')
    if (res.ok) {
      setSettings(res.data)
      setDraft(draftOf(res.data))
    } else setError(res.error)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set after the response, never synchronously
    void loadSettings()
    void loadAccounts()
  }, [loadSettings, loadAccounts])

  // The network sends people back here with the outcome in the address; read it once and tidy the address.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    const failure = params.get('error')
    if (!connected && !failure) return
    const count = Number(params.get('count') ?? '0')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of the outcome the network left in the address
    setBanner(
      failure
        ? { tone: 'bad', text: failure }
        : { tone: 'ok', text: `Connected ${count} ${connected === 'facebook' ? 'Facebook' : 'LinkedIn'} page${count === 1 ? '' : 's'}.` },
    )
    const url = new URL(window.location.href)
    for (const key of ['connected', 'error', 'count']) url.searchParams.delete(key)
    window.history.replaceState(null, '', url)
  }, [])

  async function save() {
    setSaving(true)
    setSaved('')
    setError('')
    const res = await api<SettingsView>('/admin/settings', { method: 'PATCH', body: draft })
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setSettings(res.data)
    setDraft(draftOf(res.data))
    setSaved('Saved')
    void loadAccounts()
  }

  const showSave = view === 'facebook' || view === 'linkedin'
  const patch = (p: Partial<Credentials>) => setDraft((d) => ({ ...d, ...p }))

  return (
    <div className="shub-set">
      <TabStrip
        style={{ marginBottom: '1.25rem' }}
        items={VIEWS.map((v) => ({ key: v, label: LABELS[v], active: view === v, onClick: () => setView(v) }))}
      />

      {showSave && (
        <SettingsHeaderActions>
          <SettingsHeaderStatus message={saved} error={error} />
          <button type="button" className="btn btn-primary" disabled={saving || !settings} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save app details'}
          </button>
        </SettingsHeaderActions>
      )}
      {error && !showSave && <div className="alert alert-danger" role="alert">{error}</div>}

      {!settings || !accounts ? (
        <p className="shub-note">Loading…</p>
      ) : view === 'accounts' ? (
        <AccountsPanel accounts={accounts} banner={banner} onChanged={() => void loadAccounts()} goTo={(v) => setView(v)} />
      ) : view === 'facebook' ? (
        <FacebookPanel settings={settings} draft={draft} onChange={patch} />
      ) : view === 'linkedin' ? (
        <LinkedInPanel settings={settings} draft={draft} onChange={patch} />
      ) : view === 'publishing' ? (
        <PublishingPanel adminPath={settings.adminPath} />
      ) : (
        <HelpPanel />
      )}
    </div>
  )
}
