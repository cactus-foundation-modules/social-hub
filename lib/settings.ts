import { prisma } from '@/lib/db/prisma'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import type { Provider } from '@/modules/social-hub/lib/types'

type Row = {
  fb_app_id: string | null
  fb_app_secret_enc: string | null
  fb_config_id: string | null
  li_client_id: string | null
  li_client_secret_enc: string | null
}

export type HubSettings = {
  fbAppId: string
  hasFbAppSecret: boolean
  fbConfigId: string
  liClientId: string
  hasLiClientSecret: boolean
}

export type HubSettingsPatch = {
  fbAppId?: string
  /** Empty string means "leave the saved one alone"; use clearFbAppSecret to remove it. */
  fbAppSecret?: string
  fbConfigId?: string
  liClientId?: string
  liClientSecret?: string
}

async function readRow(): Promise<Row | null> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "fb_app_id", "fb_app_secret_enc", "fb_config_id", "li_client_id", "li_client_secret_enc"
    FROM "shub_settings" WHERE "id" = 'singleton'
  `.catch(() => [] as Row[])
  return rows[0] ?? null
}

export async function getSettings(): Promise<HubSettings> {
  const row = await readRow()
  return {
    fbAppId: row?.fb_app_id ?? '',
    hasFbAppSecret: !!row?.fb_app_secret_enc,
    fbConfigId: row?.fb_config_id ?? '',
    liClientId: row?.li_client_id ?? '',
    hasLiClientSecret: !!row?.li_client_secret_enc,
  }
}

export type AppCredentials = { clientId: string; clientSecret: string; configId: string | null }

/** The app credentials for one network, decrypted - or null if either half is missing or unreadable. */
export async function getAppCredentials(provider: Provider): Promise<AppCredentials | null> {
  const row = await readRow()
  if (!row) return null
  const id = provider === 'facebook' ? row.fb_app_id : row.li_client_id
  const enc = provider === 'facebook' ? row.fb_app_secret_enc : row.li_client_secret_enc
  if (!id || !enc) return null
  try {
    return { clientId: id, clientSecret: decryptSecret(enc), configId: provider === 'facebook' ? row.fb_config_id : null }
  } catch {
    // Written under a different ENCRYPTION_KEY (a restored backup): unreadable, so not configured.
    return null
  }
}

function tidy(value: string | undefined, max: number): string | null {
  const text = (value ?? '').trim().slice(0, max)
  return text || null
}

export async function updateSettings(patch: HubSettingsPatch): Promise<void> {
  if (patch.fbAppId !== undefined) {
    await prisma.$executeRaw`UPDATE "shub_settings" SET "fb_app_id" = ${tidy(patch.fbAppId, 60)}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  if (patch.fbConfigId !== undefined) {
    await prisma.$executeRaw`UPDATE "shub_settings" SET "fb_config_id" = ${tidy(patch.fbConfigId, 60)}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  if (patch.liClientId !== undefined) {
    await prisma.$executeRaw`UPDATE "shub_settings" SET "li_client_id" = ${tidy(patch.liClientId, 60)}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  const fbSecret = tidy(patch.fbAppSecret, 200)
  if (fbSecret) {
    await prisma.$executeRaw`UPDATE "shub_settings" SET "fb_app_secret_enc" = ${encryptSecret(fbSecret)}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  const liSecret = tidy(patch.liClientSecret, 200)
  if (liSecret) {
    await prisma.$executeRaw`UPDATE "shub_settings" SET "li_client_secret_enc" = ${encryptSecret(liSecret)}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
}

