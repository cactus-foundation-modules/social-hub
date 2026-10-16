import type { Connection } from '@/modules/social-hub/lib/types'

export type SettingsView = {
  fbAppId: string
  hasFbAppSecret: boolean
  fbConfigId: string
  liClientId: string
  hasLiClientSecret: boolean
  siteUrl: string | null
  redirectUris: { facebook: string | null; linkedin: string | null }
  encryptionReady: boolean
  facebookScopes: string[]
  linkedinScopes: string[]
  facebookVersion: string
  adminPath: string
}

export type Credentials = {
  fbAppId: string
  fbAppSecret: string
  fbConfigId: string
  liClientId: string
  liClientSecret: string
}

export type AccountsView = {
  connections: Connection[]
  configured: { facebook: boolean; linkedin: boolean }
}
