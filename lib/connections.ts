import { prisma } from '@/lib/db/prisma'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import type { Connection, ConnectionStatus, Provider } from '@/modules/social-hub/lib/types'

type Row = {
  id: string
  provider: Provider
  external_id: string
  name: string
  picture_url: string | null
  profile_url: string | null
  status: ConnectionStatus
  last_error: string | null
  read_notice: string | null
  last_synced_at: Date | null
  token_expires_at: Date | null
  created_at: Date
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)

function toConnection(r: Row): Connection {
  return {
    id: r.id,
    provider: r.provider,
    externalId: r.external_id,
    name: r.name,
    pictureUrl: r.picture_url,
    profileUrl: r.profile_url,
    status: r.status,
    lastError: r.last_error,
    readNotice: r.read_notice,
    lastSyncedAt: iso(r.last_synced_at),
    tokenExpiresAt: iso(r.token_expires_at),
    createdAt: r.created_at.toISOString(),
  }
}

export async function listConnections(): Promise<Connection[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT "id", "provider", "external_id", "name", "picture_url", "profile_url", "status",
           "last_error", "read_notice", "last_synced_at", "token_expires_at", "created_at"
    FROM "shub_connections" ORDER BY "provider", "name"
  `
  return rows.map(toConnection)
}

export type ConnectionSecrets = Connection & {
  accessToken: string | null
  refreshToken: string | null
  refreshExpiresAt: string | null
}

type SecretRow = Row & {
  access_token_enc: string
  refresh_token_enc: string | null
  refresh_expires_at: Date | null
}

function toSecrets(r: SecretRow): ConnectionSecrets {
  return {
    ...toConnection(r),
    accessToken: safeDecrypt(r.access_token_enc),
    refreshToken: r.refresh_token_enc ? safeDecrypt(r.refresh_token_enc) : null,
    refreshExpiresAt: iso(r.refresh_expires_at),
  }
}

function safeDecrypt(value: string): string | null {
  try {
    return decryptSecret(value)
  } catch {
    return null
  }
}

export async function getConnectionWithSecrets(id: string): Promise<ConnectionSecrets | null> {
  const rows = await prisma.$queryRaw<SecretRow[]>`
    SELECT "id", "provider", "external_id", "name", "picture_url", "profile_url", "status",
           "last_error", "read_notice", "last_synced_at", "token_expires_at", "created_at",
           "access_token_enc", "refresh_token_enc", "refresh_expires_at"
    FROM "shub_connections" WHERE "id" = ${id}
  `
  return rows[0] ? toSecrets(rows[0]) : null
}

export async function listActiveWithSecrets(): Promise<ConnectionSecrets[]> {
  const rows = await prisma.$queryRaw<SecretRow[]>`
    SELECT "id", "provider", "external_id", "name", "picture_url", "profile_url", "status",
           "last_error", "read_notice", "last_synced_at", "token_expires_at", "created_at",
           "access_token_enc", "refresh_token_enc", "refresh_expires_at"
    FROM "shub_connections" WHERE "status" = 'active' ORDER BY "provider", "name"
  `
  return rows.map(toSecrets)
}

export type ConnectionInput = {
  provider: Provider
  externalId: string
  name: string
  pictureUrl: string | null
  profileUrl: string | null
  accessToken: string
  refreshToken: string | null
  tokenExpiresAt: Date | null
  refreshExpiresAt: Date | null
  connectedBy: string
}

/** Add a page, or refresh the credentials of one we already have. Reconnecting clears any "needs reconnecting" flag. */
export async function upsertConnection(input: ConnectionInput): Promise<void> {
  const access = encryptSecret(input.accessToken)
  const refresh = input.refreshToken ? encryptSecret(input.refreshToken) : null
  await prisma.$executeRaw`
    INSERT INTO "shub_connections"
      ("provider", "external_id", "name", "picture_url", "profile_url", "access_token_enc",
       "refresh_token_enc", "token_expires_at", "refresh_expires_at", "connected_by")
    VALUES
      (${input.provider}, ${input.externalId}, ${input.name}, ${input.pictureUrl}, ${input.profileUrl},
       ${access}, ${refresh}, ${input.tokenExpiresAt}, ${input.refreshExpiresAt}, ${input.connectedBy})
    ON CONFLICT ("provider", "external_id") DO UPDATE SET
      "name" = EXCLUDED."name",
      "picture_url" = EXCLUDED."picture_url",
      "profile_url" = EXCLUDED."profile_url",
      "access_token_enc" = EXCLUDED."access_token_enc",
      "refresh_token_enc" = EXCLUDED."refresh_token_enc",
      "token_expires_at" = EXCLUDED."token_expires_at",
      "refresh_expires_at" = EXCLUDED."refresh_expires_at",
      "connected_by" = EXCLUDED."connected_by",
      "status" = 'active',
      "last_error" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  `
  // Give back any unsent posts this page was owed before it was disconnected.
  await prisma.$executeRaw`
    INSERT INTO "shub_post_targets" ("post_id", "connection_id")
    SELECT m."post_id", c."id"
    FROM "shub_target_memory" m
    JOIN "shub_connections" c ON c."provider" = m."provider" AND c."external_id" = m."external_id"
    WHERE m."provider" = ${input.provider} AND m."external_id" = ${input.externalId}
    ON CONFLICT ("post_id", "connection_id") DO NOTHING
  `
  await prisma.$executeRaw`
    DELETE FROM "shub_target_memory" WHERE "provider" = ${input.provider} AND "external_id" = ${input.externalId}
  `
}

/** Disconnect a page. Posts still waiting to go to it are remembered, so reconnecting it puts them back. */
export async function deleteConnection(id: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "shub_target_memory" ("post_id", "provider", "external_id")
      SELECT t."post_id", c."provider", c."external_id"
      FROM "shub_post_targets" t
      JOIN "shub_connections" c ON c."id" = t."connection_id"
      JOIN "shub_posts" p ON p."id" = t."post_id"
      WHERE t."connection_id" = ${id} AND t."status" <> 'published'
        AND p."status" IN ('draft', 'scheduled', 'failed', 'partial')
      ON CONFLICT DO NOTHING
    `
    const n = await tx.$executeRaw`DELETE FROM "shub_connections" WHERE "id" = ${id}`
    return n > 0
  })
}

export async function markNeedsReauth(id: string, message: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "shub_connections" SET "status" = 'needs_reauth', "last_error" = ${message.slice(0, 500)},
      "updated_at" = CURRENT_TIMESTAMP WHERE "id" = ${id}
  `
}

export async function noteConnectionError(id: string, message: string | null): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "shub_connections" SET "last_error" = ${message ? message.slice(0, 500) : null},
      "updated_at" = CURRENT_TIMESTAMP WHERE "id" = ${id}
  `
}

export async function markSynced(id: string, notice: string | null): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "shub_connections" SET "last_synced_at" = CURRENT_TIMESTAMP, "last_error" = NULL,
      "read_notice" = ${notice ? notice.slice(0, 600) : null} WHERE "id" = ${id}
  `
}

/** Store a freshly refreshed LinkedIn token pair against every connection that shared the old one. */
export async function replaceTokens(
  id: string,
  tokens: { accessToken: string; refreshToken: string | null; tokenExpiresAt: Date | null; refreshExpiresAt: Date | null },
): Promise<void> {
  const access = encryptSecret(tokens.accessToken)
  const refresh = tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null
  await prisma.$executeRaw`
    UPDATE "shub_connections" SET
      "access_token_enc" = ${access},
      "refresh_token_enc" = COALESCE(${refresh}, "refresh_token_enc"),
      "token_expires_at" = ${tokens.tokenExpiresAt},
      "refresh_expires_at" = COALESCE(${tokens.refreshExpiresAt}, "refresh_expires_at"),
      "status" = 'active', "last_error" = NULL, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `
}
