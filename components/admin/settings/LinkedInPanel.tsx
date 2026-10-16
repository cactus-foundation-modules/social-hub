'use client'

import { Code, CopyField, Ext, Steps } from '@/modules/social-hub/components/admin/settings/ui'
import type { Credentials, SettingsView } from '@/modules/social-hub/components/admin/settings/types'

type Props = {
  settings: SettingsView
  draft: Credentials
  onChange: (patch: Partial<Credentials>) => void
}

export function LinkedInPanel({ settings, draft, onChange }: Props) {
  return (
    <div className="shub-set settings-cols">
      <div className="card">
        <h3 className="card-title">Your LinkedIn app</h3>
        <div className="settings-fields">
          <div className="field">
            <label>Client ID</label>
            <input value={draft.liClientId} onChange={(e) => onChange({ liClientId: e.target.value })} placeholder="86abcd1234xyz" autoComplete="off" />
          </div>
          <div className="field">
            <label>Primary client secret</label>
            <input type="password" value={draft.liClientSecret} onChange={(e) => onChange({ liClientSecret: e.target.value })}
              placeholder={settings.hasLiClientSecret ? 'Saved - type to replace' : 'Paste the client secret'} autoComplete="new-password" />
          </div>
        </div>
        <CopyField label="Redirect address to give LinkedIn" value={settings.redirectUris.linkedin} />
        {!settings.encryptionReady && <p className="field-error">This site has no usable ENCRYPTION_KEY, so the client secret cannot be stored. Ask whoever runs the site to set one.</p>}
        <p className="shub-note">The secret is stored encrypted and never shown again. Press <strong>Save</strong> at the top, then go to <strong>Accounts</strong> to connect.</p>
      </div>

      <div className="card">
        <h3 className="card-title">How to set it up</h3>
        <p className="shub-note" style={{ marginTop: 0, marginBottom: '1rem' }}>
          LinkedIn is stricter than Facebook: posting as a company Page needs LinkedIn&apos;s <strong>Community Management API</strong>, which they approve by hand.
          Start the application early - it can take a few days.
        </p>
        <Steps>
          <li>
            <strong>Create the app.</strong> Go to <Ext href="https://www.linkedin.com/developers/apps">linkedin.com/developers/apps</Ext> and click <strong>Create app</strong>.
            Give it a name, choose the <strong>LinkedIn Page</strong> for your business (you must be an admin of it), upload a logo and accept the terms.
            Use a new app just for this: LinkedIn will not always allow the Community Management API alongside other products on the same app.
          </li>
          <li>
            <strong>Verify the app belongs to the Page.</strong> On the app&apos;s <strong>Settings</strong> tab click <strong>Verify</strong> next to the Page. LinkedIn gives you a link; a super admin of the
            Page opens it and approves.
          </li>
          <li>
            <strong>Ask for the Community Management API.</strong> On the <strong>Products</strong> tab find <strong>Community Management API</strong> and click <strong>Request access</strong>.
            Fill in the form honestly: you are a business posting to your own company Page from your own website. Use a business email address.
            Wait for LinkedIn&apos;s approval email; the product then shows as added.
          </li>
          <li>
            <strong>Tell LinkedIn where to send people back to.</strong> On the <strong>Auth</strong> tab, under <strong>OAuth 2.0 settings</strong>, click the pencil beside
            <strong> Authorized redirect URLs</strong> and add the redirect address from the box on this page exactly as shown. Save.
          </li>
          <li>
            <strong>Check the permissions.</strong> Still on the <strong>Auth</strong> tab, the <strong>OAuth 2.0 scopes</strong> list should include
            <Code>r_organization_social</Code>, <Code>w_organization_social</Code> and <Code>rw_organization_admin</Code>. If they are missing, the Community Management API has not been approved yet.
          </li>
          <li>
            <strong>Copy the app details here.</strong> From the <strong>Auth</strong> tab copy the <strong>Client ID</strong> and the <strong>Primary Client Secret</strong> (use the eye icon to reveal it)
            into the boxes above and press <strong>Save</strong>.
          </li>
          <li>
            <strong>Connect your Page.</strong> Go to the <strong>Accounts</strong> tab and press <strong>Connect LinkedIn</strong>. Sign in as a super admin or content admin of the Page, approve the
            permissions, and the Pages you administer appear on the Accounts tab.
          </li>
        </Steps>
        <p className="shub-note">
          LinkedIn sign-ins last about 60 days. Social Hub renews them quietly when LinkedIn has given your app a refresh token; if not, the Page is marked
          &ldquo;Needs reconnecting&rdquo; and you will see it in the bell - press <strong>Reconnect</strong> on the Accounts tab and you are done for another two months.
          LinkedIn has no scheduling of its own, so Social Hub keeps scheduled posts and sends them itself when their time comes.
        </p>
      </div>
    </div>
  )
}
