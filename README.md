<p align="center">
  <img src="module-art.webp" alt="Social Hub" width="640" />
</p>

# Social Hub

Connect your Facebook Page and LinkedIn Page to your Cactus site, see what you have already posted on both, and write, schedule and publish new posts - with pictures and link previews - from one admin page.

It lives in the admin sidebar as **Social Hub**. Its settings are on the **Settings** page under the **Social Hub** tab.

## What it does

- **Connect pages.** One button per network. Social Hub finds every Facebook Page you manage and every LinkedIn Page you administer and lets you post to any of them.
- **See what is already there.** The **Published** list shows recent posts from every connected page, with pictures, link cards, and likes, comments and shares. Filter by page. It refreshes hourly, or when you press the refresh button.
- **Write and publish.** A sheet with a text box, up to four pictures from the site's media library (or upload new ones), and a link. A link you type or paste becomes a preview card, like the networks show it.
- **Post to several pages at once.** Tick the pages. If one fails the post is marked **Partly posted** and only the failed page is retried.
- **Schedule.** Pick a date and time, or use a quick choice. Scheduled posts are kept on your site and sent when the time comes. LinkedIn's API has no scheduling of its own, so Social Hub does it for both networks and they behave the same way.
- **Drafts, edit, retry, delete.** Everything that has not gone out can be edited. Failures are listed under **Needs attention** with the network's own reason, and raise a single rolling notification in the admin bell.

## Setting it up

You need a Facebook (Meta) developer app and a LinkedIn developer app. The **Facebook setup** and **LinkedIn setup** sub-tabs under Settings → Social Hub walk through it step by step, show the redirect address to copy, and have boxes for the app details.

In short:

**Facebook**
1. Create an app at [developers.facebook.com/apps](https://developers.facebook.com/apps/) with the **Manage everything on your Page** use case.
2. Add the permissions `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`.
3. Under Facebook Login settings, add the redirect address shown in Social Hub as a **Valid OAuth Redirect URI**. (If your app uses *Facebook Login for Business*, create a configuration with those permissions and paste its **Configuration ID** into Social Hub.)
4. Copy the **App ID** and **App secret** (App settings → Basic) into Social Hub and save.
5. Make the app **Live** (posts made by an app in Development mode are only visible to people with a role on it).
6. Press **Connect Facebook** on the Accounts tab and tick your Pages.

**LinkedIn**
1. Create an app at [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) tied to your company Page, and have a super admin of the Page verify it.
2. On the **Products** tab request the **Community Management API** (LinkedIn approves it by hand - it can take a few days).
3. On the **Auth** tab add the redirect address shown in Social Hub under **Authorized redirect URLs**.
4. Copy the **Client ID** and **Primary Client Secret** into Social Hub and save.
5. Press **Connect LinkedIn** on the Accounts tab.

Facebook Page connections do not expire. LinkedIn sign-ins last about 60 days; they are renewed automatically when LinkedIn issues a refresh token, otherwise the page is flagged **Needs reconnecting** and one press of Reconnect sorts it for another two months.

## Permissions

| Key | Lets someone |
| --- | --- |
| `socialhub.view` | open Social Hub and read the lists |
| `socialhub.post` | write, schedule, publish, edit, retry and delete posts, and refresh the lists |
| `socialhub.manage` | connect and disconnect pages, and edit the settings |

## How it works (for developers)

- **Tables** (prefix `shub_`): `shub_settings` (singleton: app ids, encrypted secrets), `shub_connections` (one row per page, tokens encrypted with core's `ENCRYPTION_KEY`), `shub_posts`, `shub_post_targets` (one per page per post), `shub_remote_posts` (cache of what is on each page).
- **Facebook:** Graph API v24. A page token taken from a long-lived user token does not expire. Text and link posts go to `/{page}/feed`; one picture to `/{page}/photos`; several are uploaded unpublished and attached to a feed post.
- **LinkedIn:** the versioned REST Posts API (`LinkedIn-Version` pinned in `lib/linkedin.ts`), images through the Images API, articles with an uploaded thumbnail. Commentary is escaped for LinkedIn's "little text format" (`lib/linkedin-text.ts`), because an unescaped bracket truncates a post.
- **Scheduling:** `/api/m/social-hub/cron/publish` (every 5 minutes, honoured to the site's tick). A post is claimed with `UPDATE ... FOR UPDATE SKIP LOCKED`, so two runners cannot send the same post, and a post left "publishing" by a dead runner is failed after 15 minutes rather than risking a double post.
- **Refresh:** `/api/m/social-hub/cron/sync` (hourly) and the refresh button.
- **Link previews and remote pictures** are fetched server-side through `lib/safe-fetch.ts`, which refuses anything that resolves to a private address at every redirect hop. Remote pictures reach the admin through `/api/m/social-hub/admin/image`, because the site's content security policy allows no third-party image hosts and widening it for every visitor would be the wrong trade.
- **OAuth:** the `state` parameter is bound to a sealed, ten-minute, httpOnly cookie that also pins the person and the network.
- **Tests:** `npm test` in core runs `lib/social-hub.test.ts`. The raw SQL and the whole publish path (against a stubbed network) are run for real by `lib/social-hub.live.test.ts`:

  ```bash
  RUN_SOCIAL_HUB_LIVE=1 npx vitest run modules/social-hub/lib/social-hub.live.test.ts --testTimeout 120000
  ```

  It needs `OVH_SERVER`, `OVH_USER` and `OVH_PASSWORD` exported from the Deskwell workspace `.env`. A skip is a fail.

## Requires

- Cactus core 0.5.1779 or later.
- `ENCRYPTION_KEY` (core already sets this).
