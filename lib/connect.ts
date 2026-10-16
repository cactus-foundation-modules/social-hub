import { upsertConnection } from '@/modules/social-hub/lib/connections'
import { completeFacebookLogin } from '@/modules/social-hub/lib/facebook'
import { completeLinkedInLogin } from '@/modules/social-hub/lib/linkedin'
import { getAppCredentials, redirectUri } from '@/modules/social-hub/lib/settings'
import { SocialError, type Provider } from '@/modules/social-hub/lib/types'

/** Finish a login: swap the code for tokens, find every page the person runs, and save them. Answers how many. */
export async function completeConnection(provider: Provider, code: string, userId: string): Promise<number> {
  const creds = await getAppCredentials(provider)
  const redirect = redirectUri(provider)
  if (!creds || !redirect) throw new SocialError('The app details for this network are not saved yet.')

  if (provider === 'facebook') {
    const login = await completeFacebookLogin(creds, redirect, code)
    for (const page of login.pages) {
      await upsertConnection({
        provider,
        externalId: page.externalId,
        name: page.name,
        pictureUrl: page.pictureUrl,
        profileUrl: page.profileUrl,
        accessToken: login.pageTokens?.[page.externalId] ?? login.accessToken,
        refreshToken: null,
        tokenExpiresAt: null,
        refreshExpiresAt: null,
        connectedBy: userId,
      })
    }
    return login.pages.length
  }

  const login = await completeLinkedInLogin(creds, redirect, code)
  for (const page of login.pages) {
    await upsertConnection({
      provider,
      externalId: page.externalId,
      name: page.name,
      pictureUrl: page.pictureUrl,
      profileUrl: page.profileUrl,
      accessToken: login.accessToken,
      refreshToken: login.refreshToken,
      tokenExpiresAt: login.tokenExpiresAt,
      refreshExpiresAt: login.refreshExpiresAt,
      connectedBy: userId,
    })
  }
  return login.pages.length
}
