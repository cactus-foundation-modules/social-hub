// GET/PATCH /api/m/social-hub/admin/settings
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { getSiteUrlOrNull } from '@/lib/config/env'
import { isEncryptionKeyUsable } from '@/lib/crypto/secrets'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { FB_GRAPH_VERSION, FB_SCOPES } from '@/modules/social-hub/lib/facebook'
import { LI_SCOPES } from '@/modules/social-hub/lib/linkedin'
import { getSettings, redirectUri, updateSettings } from '@/modules/social-hub/lib/settings'

async function view() {
  const config = await prisma.siteConfig
    .findUnique({ where: { id: 'singleton' }, select: { adminPath: true } })
    .catch(() => null)
  const siteUrl = getSiteUrlOrNull()
  return {
    ...(await getSettings()),
    siteUrl,
    redirectUris: { facebook: redirectUri('facebook', siteUrl), linkedin: redirectUri('linkedin', siteUrl) },
    encryptionReady: isEncryptionKeyUsable(),
    facebookScopes: [...FB_SCOPES],
    linkedinScopes: [...LI_SCOPES],
    facebookVersion: FB_GRAPH_VERSION,
    adminPath: config?.adminPath ?? 'cactus-admin',
  }
}

export async function GET() {
  const g = await guard('manage')
  if ('response' in g) return g.response
  return NextResponse.json(await view())
}

const Body = z.object({
  fbAppId: z.string().max(60).optional(),
  fbAppSecret: z.string().max(200).optional(),
  fbConfigId: z.string().max(60).optional(),
  liClientId: z.string().max(60).optional(),
  liClientSecret: z.string().max(200).optional(),
})

export async function PATCH(request: NextRequest) {
  const g = await guard('manage')
  if ('response' in g) return g.response
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid settings', 400)
  if ((parsed.data.fbAppSecret || parsed.data.liClientSecret) && !isEncryptionKeyUsable()) {
    return errorResponse('ENCRYPTION_KEY is missing on this site, so secrets cannot be stored safely.', 409)
  }
  await updateSettings(parsed.data)
  return NextResponse.json(await view())
}
