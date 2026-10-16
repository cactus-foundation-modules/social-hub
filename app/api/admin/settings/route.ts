// GET/PATCH /api/m/social-hub/admin/settings
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { isEncryptionKeyUsable } from '@/lib/crypto/secrets'
import { errorResponse } from '@/lib/utils'
import { guard } from '@/modules/social-hub/lib/api'
import { FB_GRAPH_VERSION, FB_SCOPES } from '@/modules/social-hub/lib/facebook'
import { LI_SCOPES } from '@/modules/social-hub/lib/linkedin'
import { callbackUrl, requestOrigin } from '@/modules/social-hub/lib/origin'
import { getSettings, updateSettings } from '@/modules/social-hub/lib/settings'

async function view(request: Request) {
  const config = await prisma.siteConfig
    .findUnique({ where: { id: 'singleton' }, select: { adminPath: true } })
    .catch(() => null)
  const siteUrl = requestOrigin(request.headers, new URL(request.url).origin)
  return {
    ...(await getSettings()),
    siteUrl,
    redirectUris: { facebook: callbackUrl('facebook', siteUrl), linkedin: callbackUrl('linkedin', siteUrl) },
    encryptionReady: isEncryptionKeyUsable(),
    facebookScopes: [...FB_SCOPES],
    linkedinScopes: [...LI_SCOPES],
    facebookVersion: FB_GRAPH_VERSION,
    adminPath: config?.adminPath ?? 'cactus-admin',
  }
}

export async function GET(request: NextRequest) {
  const g = await guard('manage')
  if ('response' in g) return g.response
  return NextResponse.json(await view(request))
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
  return NextResponse.json(await view(request))
}
