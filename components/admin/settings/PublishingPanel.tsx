'use client'

import { CronScheduleSetting } from '@/components/admin/CronScheduleField'
import { LIMITS } from '@/modules/social-hub/lib/types'

export function PublishingPanel({ adminPath }: { adminPath: string }) {
  return (
    <div className="shub-set settings-cols">
      <div className="card">
        <h3 className="card-title">How often Social Hub checks</h3>
        <div className="settings-fields">
          <CronScheduleSetting
            path="/api/m/social-hub/cron/publish"
            label="Send scheduled posts"
            hint="How often the site looks for posts whose time has come. A post goes out on or after its time, at the next check."
          />
          <CronScheduleSetting
            path="/api/m/social-hub/cron/sync"
            label="Refresh the Published list"
            hint="How often your pages are read again for new posts, likes and comments. The refresh button on the Social Hub page does it on demand."
          />
        </div>
        <p className="shub-note">
          Faster checks mean the site wakes more often, which on some hosting plans means more usage. If a post has to go out at an exact minute, open
          Social Hub and press <strong>Post now</strong> on it.
        </p>
      </div>

      <div className="card">
        <h3 className="card-title">Good to know</h3>
        <ul className="shub-note" style={{ marginTop: 0, paddingLeft: '1.1rem' }}>
          <li>Times are entered in the time zone of the browser you are using, and stored exactly.</li>
          <li>A post can be up to {LIMITS.bodyMax.toLocaleString()} characters and carry up to {LIMITS.imagesMax} pictures.</li>
          <li>With pictures attached, a link goes into the text of the post rather than showing as a preview card. That is how both networks behave.</li>
          <li>If one page fails and another works, the post is marked &ldquo;Partly posted&rdquo; and only the failed page is retried.</li>
          <li>Failures and pages that need reconnecting appear in the admin bell.</li>
        </ul>
        <p className="shub-note">
          Who can do what is set under <a href={`/${adminPath}/roles`}>Roles</a>: <strong>View</strong> reads the lists, <strong>Post</strong> writes, schedules and publishes,
          <strong> Manage</strong> connects pages and edits these settings.
        </p>
      </div>
    </div>
  )
}
