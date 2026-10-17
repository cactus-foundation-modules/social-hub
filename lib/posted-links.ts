import { prisma } from '@/lib/db/prisma'
import { bestPerConnection, normaliseLink, postLinkKeys, type LinkHit, type LinkMatches } from '@/modules/social-hub/lib/link-match'
import type { Provider } from '@/modules/social-hub/lib/types'

type RemoteRow = {
  connection_id: string
  provider: Provider
  message: string
  link_url: string | null
  permalink: string | null
  posted_at: Date | null
}

type TargetRow = {
  connection_id: string
  provider: Provider
  body: string
  link_url: string | null
  post_status: string
  scheduled_at: Date | null
  target_status: string
  permalink: string | null
  error: string | null
  published_at: Date | null
}

/**
 * For each web address asked about, what every connected page has done with it:
 * published it, scheduled it, or tried and failed. Two sources are read, because
 * neither alone is the whole story - the cache of what is on each page (which
 * includes posts made outside Social Hub, as long as they are recent enough to
 * have been read) and Social Hub's own posts (which is the only place a scheduled
 * post exists at all). A scheduled post with no pages chosen yet still counts as
 * scheduled on every connected page: it is waiting, not absent.
 */
export async function matchPostedLinks(urls: string[]): Promise<LinkMatches> {
  // Normalised address -> the addresses as the caller wrote them.
  const wanted = new Map<string, string[]>()
  for (const url of urls) {
    const key = normaliseLink(url)
    if (!key) continue
    wanted.set(key, [...(wanted.get(key) ?? []), url])
  }
  const result: LinkMatches = {}
  for (const url of urls) result[url] = { facebook: [], linkedin: [] }
  if (wanted.size === 0) return result

  const [remote, targets] = await Promise.all([
    prisma.$queryRaw<RemoteRow[]>`
      SELECT r."connection_id", c."provider", r."message", r."link_url", r."permalink", r."posted_at"
      FROM "shub_remote_posts" r
      JOIN "shub_connections" c ON c."id" = r."connection_id"
      WHERE r."link_url" IS NOT NULL OR r."message" LIKE '%http%'
    `,
    prisma.$queryRaw<TargetRow[]>`
      SELECT c."id" AS "connection_id", c."provider", p."body", p."link_url", p."status" AS "post_status",
             p."scheduled_at", COALESCE(t."status", 'pending') AS "target_status", t."permalink", t."error", t."published_at"
      FROM "shub_posts" p
      JOIN "shub_connections" c ON TRUE
      LEFT JOIN "shub_post_targets" t ON t."post_id" = p."id" AND t."connection_id" = c."id"
      WHERE p."status" <> 'draft'
        AND (t."id" IS NOT NULL
             OR (p."status" IN ('scheduled', 'publishing')
                 AND NOT EXISTS (SELECT 1 FROM "shub_post_targets" x WHERE x."post_id" = p."id")))
    `,
  ])

  const found = new Map<string, Array<{ provider: Provider; hit: LinkHit }>>()
  const note = (keys: Set<string>, provider: Provider, hit: LinkHit) => {
    for (const key of keys) {
      if (!wanted.has(key)) continue
      found.set(key, [...(found.get(key) ?? []), { provider, hit }])
    }
  }

  for (const r of remote) {
    note(postLinkKeys(r.link_url, r.message), r.provider, {
      connectionId: r.connection_id,
      state: 'published',
      permalink: r.permalink,
      at: r.posted_at?.toISOString() ?? null,
      error: null,
    })
  }

  for (const t of targets) {
    const keys = postLinkKeys(t.link_url, t.body)
    if (t.target_status === 'published') {
      note(keys, t.provider, {
        connectionId: t.connection_id, state: 'published', permalink: t.permalink,
        at: t.published_at?.toISOString() ?? null, error: null,
      })
    } else if (t.target_status === 'failed') {
      note(keys, t.provider, {
        connectionId: t.connection_id, state: 'failed', permalink: null,
        at: t.scheduled_at?.toISOString() ?? null, error: t.error,
      })
    } else if (t.post_status === 'scheduled' || t.post_status === 'publishing') {
      // Still waiting. A post claimed by the publisher this minute is as good as out,
      // but it has not landed yet, so it keeps its due time.
      note(keys, t.provider, {
        connectionId: t.connection_id, state: 'scheduled', permalink: null,
        at: t.scheduled_at?.toISOString() ?? null, error: null,
      })
    }
  }

  for (const [key, originals] of wanted) {
    const entries = found.get(key) ?? []
    for (const provider of ['facebook', 'linkedin'] as const) {
      const hits = bestPerConnection(entries.filter((e) => e.provider === provider).map((e) => e.hit))
      for (const original of originals) result[original]![provider] = hits
    }
  }
  return result
}
