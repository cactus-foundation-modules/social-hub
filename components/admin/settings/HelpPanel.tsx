'use client'

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Facebook says "This is an invalid redirect URI for this application".',
    a: 'The redirect address is not saved in your Facebook app. In Facebook Login for Business → Settings, paste the address from the Facebook setup tab into Valid OAuth Redirect URIs, press Enter so it becomes a tag, press Save changes, then reload the page and run Check URI in the validator at the top. It must say the address is valid.',
  },
  {
    q: 'Facebook says "Can\'t load URL - the domain of this URL isn\'t included in the app\'s domains".',
    a: 'In your Facebook app go to App settings → Basic, add your site\'s domain (for example example.com, without https://) to App domains, add a Website platform with your site address, and save. The address in the sign-in URL must match: sign in to this admin on the same address you gave Facebook, and make sure the redirect address on the Facebook setup tab is in Valid OAuth Redirect URIs.',
  },
  {
    q: 'Facebook says it did not share any Pages.',
    a: 'On the step where Facebook lets you choose, tick the Pages you want to use. You also need to be an admin of the Page (or have full control of it). If you skipped it, press Connect again and choose Pages this time.',
  },
  {
    q: 'My Facebook post only shows for me, not the public.',
    a: 'The Facebook app is still in Development mode. Make it Live in the Facebook developer dashboard (you will need a privacy policy address) and post again.',
  },
  {
    q: 'Facebook says a permission is missing.',
    a: 'Open your app on developers.facebook.com, check pages_manage_posts and pages_read_engagement are added to the use case, then press Reconnect on the Accounts tab and approve everything Facebook lists.',
  },
  {
    q: 'LinkedIn shows no Pages after connecting.',
    a: 'You need to be a super admin or content admin of the LinkedIn Page, and your LinkedIn app must have the Community Management API approved. Until LinkedIn approves it the Pages list comes back empty.',
  },
  {
    q: 'LinkedIn refused the post with a 403.',
    a: 'Almost always a permission: the Community Management API is not approved yet, or the person who connected is not an admin of that Page. Fix that and reconnect.',
  },
  {
    q: 'A page says "Needs reconnecting".',
    a: 'The network stopped accepting our access - the password changed, admin access was removed, or (for LinkedIn) the sixty-day sign-in ran out. Press Reconnect on the Accounts tab. Scheduled posts for that page wait as failed until you do, and can be retried from Needs attention.',
  },
  {
    q: 'Pictures in my post are missing.',
    a: 'Pictures must be reachable on the public internet, because Facebook and LinkedIn fetch them. A picture from the media library works. On a site that is only running on your own computer, the networks cannot reach it.',
  },
  {
    q: 'How exact are scheduled times?',
    a: 'A post goes out on or after its time, at the next check. Checks run every five minutes where the site allows it. You can see and change the schedule under Publishing, and Post now sends any post immediately.',
  },
  {
    q: 'What happens if I disconnect a page?',
    a: 'Social Hub forgets the connection and its saved copy of the Page\'s posts. Nothing on the Page itself is touched, and posts you wrote here stay in your lists.',
  },
]

export function HelpPanel() {
  return (
    <div className="shub-set settings-cols">
      <div className="card shub-faq">
        <h3 className="card-title">Troubleshooting</h3>
        {FAQ.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  )
}
