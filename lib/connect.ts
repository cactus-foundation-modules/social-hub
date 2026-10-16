import { upsertConnection } from '@/modules/social-hub/lib/connections'
import { completeFacebookLogin } from '@/modules/social-hub/lib/facebook'
import { completeLinkedInLogin } from '@/modules/social-hub/lib/linkedin'
import { getAppCredentials } from '@/modules/social-hub/lib/settings'
import { SocialError, type Provider } from '@/modules/social-hub/lib/types'

/** Finish a login: swap the code for tokens, find every page the person runs, and save them. Answers how many. */
export async function completeConnection(provider: Provider, code: string, userId: string, redirect: string): Promise<number> {
  const creds = await getAppCredentials(provider)
  if (!creds) throw new SocialError('The app details for this network are not saved yet.')

  if (provider === 'facebook') {
    const login = await completeFacebookLogin(creds, redirect, code)
    if (login.missingPermissions && login.missingPermissions.length > 0) {
      throw new SocialError(
        `Facebook signed you in but did not grant: ${login.missingPermissions.join(', ')}. ` +
          'If your Facebook app uses Facebook Login for Business, create a Configuration containing those permissions (Facebook Login for Business → Configurations), paste its Configuration ID into the Facebook setup tab, save, and connect again.',
      )
    }
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
