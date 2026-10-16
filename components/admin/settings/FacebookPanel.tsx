'use client'

import { hostOf as hostFrom } from '@/modules/social-hub/components/admin/hub/format'
import { InfoTip } from '@/components/admin/InfoTip'
import { Code, CopyField, Ext, Steps } from '@/modules/social-hub/components/admin/settings/ui'
import type { Credentials, SettingsView } from '@/modules/social-hub/components/admin/settings/types'

type Props = {
  settings: SettingsView
  draft: Credentials
  onChange: (patch: Partial<Credentials>) => void
}

export function FacebookPanel({ settings, draft, onChange }: Props) {
  const domain = settings.siteUrl ? hostFrom(settings.siteUrl) : 'your-site.com'
  return (
    <div className="shub-set settings-cols">
      <div className="card">
        <h3 className="card-title">Your Facebook app</h3>
        <div className="settings-fields">
          <div className="field">
            <label>App ID</label>
            <input value={draft.fbAppId} onChange={(e) => onChange({ fbAppId: e.target.value })} placeholder="1234567890123456" inputMode="numeric" autoComplete="off" />
          </div>
          <div className="field">
            <label>App secret</label>
            <input type="password" value={draft.fbAppSecret} onChange={(e) => onChange({ fbAppSecret: e.target.value })}
              placeholder={settings.hasFbAppSecret ? 'Saved - type to replace' : 'Paste the app secret'} autoComplete="new-password" />
          </div>
          <div className="field field--wide">
            <label>
              Login configuration ID (optional)
              <InfoTip>Only needed if your app uses &ldquo;Facebook Login for Business&rdquo;, which asks for a saved configuration instead of a list of permissions. Leave it empty for an ordinary Facebook Login app.</InfoTip>
            </label>
            <input value={draft.fbConfigId} onChange={(e) => onChange({ fbConfigId: e.target.value })} placeholder="Leave empty unless Facebook asks for one" autoComplete="off" />
          </div>
        </div>
        <CopyField label="Redirect address to give Facebook" value={settings.redirectUris.facebook} />
        {!settings.encryptionReady && <p className="field-error">This site has no usable ENCRYPTION_KEY, so the app secret cannot be stored. Ask whoever runs the site to set one.</p>}
        <p className="shub-note">The secret is stored encrypted and never shown again. Press <strong>Save</strong> at the top, then go to <strong>Accounts</strong> to connect.</p>
      </div>

      <div className="card">
        <h3 className="card-title">How to set it up</h3>
        <p className="shub-note" style={{ marginTop: 0, marginBottom: '1rem' }}>
          You do this once, on Facebook&apos;s developer site. It takes about ten minutes. Facebook rearranges its menus now and then,
          so if a name is slightly different, look for the closest match.
        </p>
        <Steps>
          <li>
            <strong>Sign in to Meta for Developers.</strong> Go to <Ext href="https://developers.facebook.com/apps/">developers.facebook.com/apps</Ext> with the Facebook account
            that is an <em>admin</em> of the Page you want to post to. If it is your first time, Facebook asks you to register as a developer.
          </li>
          <li>
            <strong>Create the app.</strong> Click <strong>Create app</strong>, name it something you will recognise (such as &ldquo;Our website Social Hub&rdquo;), add a contact email,
            and carry on. When asked what you want the app to do, choose <strong>Manage everything on your Page</strong>. You can skip connecting a business portfolio.
          </li>
          <li>
            <strong>Add the permissions.</strong> Open the app&apos;s <strong>Use cases</strong>, choose <strong>Customize</strong> on that use case, and click <strong>Add</strong> next to:
            <ul>
              <li><Code>pages_show_list</Code> (already there by default)</li>
              <li><Code>pages_read_engagement</Code> - lets us read your existing posts and their likes and comments</li>
              <li><Code>pages_manage_posts</Code> - lets us publish and schedule posts</li>
            </ul>
          </li>
          <li>
            <strong>Add your site&apos;s domain.</strong> In <strong>App settings → Basic</strong>, put <Code>{domain}</Code> in <strong>App domains</strong>, then click
            <strong> Add platform</strong>, choose <strong>Website</strong> and enter <Code>{settings.siteUrl ?? 'https://your-site'}</Code> as the Site URL. Save changes.
            Facebook refuses a sign-in with &ldquo;Can&apos;t load URL - the domain of this URL isn&apos;t included in the app&apos;s domains&rdquo; if this is missing or spelt
            differently from the address you are using to sign in to this admin.
          </li>
          <li>
            <strong>Tell Facebook where to send people back to.</strong> This is the step that is easiest to get wrong. Under <strong>Facebook Login for Business → Settings</strong>
            (or <strong>Facebook Login → Settings</strong> on an older app), find <strong>Valid OAuth Redirect URIs</strong> and:
            <ul>
              <li>Paste the redirect address from the box on this page exactly as shown - no trailing space or slash.</li>
              <li><strong>Press Enter</strong> so it turns into a tag with an ✕. Text left loose in the box is thrown away when you save.</li>
              <li>Make sure <strong>Client OAuth login</strong> and <strong>Web OAuth login</strong> are on, then press <strong>Save changes</strong> at the bottom of the page and look for the green confirmation.</li>
              <li>Paste the same address into the <strong>Redirect URI Validator</strong> at the top of that page and press <strong>Check URI</strong>. It must say the address is valid before you carry on. If it says &ldquo;invalid redirect URI&rdquo;, the address did not save - reload the page and check the tag is still there.</li>
            </ul>
          </li>
          <li>
            <strong>If your app uses Facebook Login for Business, create a login configuration.</strong> You will know: it is in the app&apos;s left-hand menu. Such apps ignore the permissions Social Hub asks for and
            grant only what a saved configuration lists - without one, connecting appears to work but Facebook then refuses to let us read or publish posts
            (&ldquo;requires the pages_read_engagement permission&rdquo;). Open <strong>Facebook Login for Business → Configurations → Create configuration</strong>, choose the
            <strong> General</strong> login variation and a <strong>User access token</strong>, add all three permissions above, then copy the <strong>Configuration ID</strong> into the optional box on this page and save.
            An older app with plain <strong>Facebook Login</strong> does not need this.
          </li>
          <li>
            <strong>Copy the app details here.</strong> In the app, open <strong>App settings → Basic</strong>. Copy the <strong>App ID</strong> and click <strong>Show</strong> next to the
            <strong> App secret</strong> and copy that too. Paste both into the boxes above and press <strong>Save</strong>.
          </li>
          <li>
            <strong>Make the app Live.</strong> Still in <strong>App settings → Basic</strong>, add a <strong>Privacy policy URL</strong> (your site&apos;s privacy page), an app icon and a category, then use the
            switch at the top of the dashboard to move the app from <em>Development</em> to <em>Live</em>. This matters:
            posts published by an app that is still in Development mode are only visible to people with a role on the app, not to the public.
            You do not normally need App Review when every person connecting is an admin or developer of the app and the Pages are ones they manage.
          </li>
          <li>
            <strong>Connect your Page.</strong> Go to the <strong>Accounts</strong> tab and press <strong>Connect Facebook</strong>. Facebook asks you to approve; when it lets you choose Pages,
            tick every Page you want Social Hub to use. They appear on the Accounts tab straight away.
          </li>
        </Steps>
        <p className="shub-note">
          Facebook page connections do not expire by themselves. They stop working if the person who connected them changes their Facebook password,
          loses their admin role on the Page or removes the app - Social Hub then marks the Page &ldquo;Needs reconnecting&rdquo; and tells you in the bell.
          Using Graph API {settings.facebookVersion}.
        </p>
      </div>
    </div>
  )
}
