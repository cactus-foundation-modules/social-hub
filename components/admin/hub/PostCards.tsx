'use client'

import { PROVIDER_LABEL, type Connection, type Post, type RemotePost } from '@/modules/social-hub/lib/types'
import { Avatar, LinkCard, MediaGrid, PostMenu, PostText, RemoteLinkCard, StatusPill, ViewLink, type PostMenuItem } from '@/modules/social-hub/components/admin/hub/Parts'
import { fullDateTime, relativeTime } from '@/modules/social-hub/components/admin/hub/format'
import { Icon } from '@/modules/social-hub/components/admin/hub/Glyphs'

export function RemotePostRow({
  post, connection, busy, onEdit, onDelete,
}: {
  post: RemotePost
  connection: Connection | undefined
  busy?: boolean
  /** Present only for someone allowed to edit, on a network that lets live posts be edited. */
  onEdit?: (post: RemotePost) => void
  /** Present only for someone allowed to delete; leaves the menu entry out otherwise. */
  onDelete?: (post: RemotePost) => void
}) {
  const stats: { icon: 'like' | 'comment' | 'share'; n: number | null; label: string }[] = [
    { icon: 'like', n: post.likeCount, label: 'reactions' },
    { icon: 'comment', n: post.commentCount, label: 'comments' },
    { icon: 'share', n: post.shareCount, label: 'shares' },
  ]
  const network = PROVIDER_LABEL[post.provider]
  const menu: PostMenuItem[] = []
  if (post.permalink) menu.push({ label: `View on ${network}`, icon: 'external', href: post.permalink })
  if (onEdit) menu.push({ label: 'Edit Post', icon: 'edit', onSelect: () => onEdit(post), disabled: busy })
  if (onDelete) menu.push({ label: 'Delete Post', icon: 'trash', onSelect: () => onDelete(post), danger: true, disabled: busy })
  // A link post's one picture is the link's own thumbnail, so it goes inside the card rather than beside it.
  const sharesLink = !!post.linkUrl && !!post.linkTitle
  return (
    <article className="shub-row">
      <div className="shub-post-head">
        <Avatar name={post.connectionName} pictureUrl={connection?.pictureUrl ?? null} provider={post.provider} />
        <div className="shub-post-who">
          <div className="shub-post-name">{post.connectionName}</div>
          <div className="shub-post-when" title={fullDateTime(post.postedAt)}>{relativeTime(post.postedAt)}</div>
        </div>
        {post.viaSocialHub && <span className="shub-via">Posted here</span>}
        <PostMenu items={menu} />
      </div>
      <PostText text={post.message} />
      {!sharesLink && <MediaGrid urls={post.imageUrls} />}
      {post.linkUrl && <RemoteLinkCard url={post.linkUrl} title={post.linkTitle} imageUrl={sharesLink ? post.imageUrls[0] ?? null : null} />}
      {stats.some((s) => s.n !== null) && (
        <div className="shub-post-foot">
          {stats.map((s) => s.n !== null && (
            <span key={s.icon} className="shub-stat" title={s.label}><Icon name={s.icon} size={14} /> {s.n}</span>
          ))}
        </div>
      )}
    </article>
  )
}

const STATUS_LABEL: Record<Post['status'], string> = {
  draft: 'Draft', scheduled: 'Scheduled', publishing: 'Posting…', published: 'Posted', partial: 'Partly posted', failed: 'Did not post',
}
const STATUS_TONE: Record<Post['status'], 'ok' | 'warn' | 'bad' | 'info' | undefined> = {
  draft: undefined, scheduled: 'info', publishing: 'info', published: 'ok', partial: 'warn', failed: 'bad',
}

export function LocalPostRow({
  post, connections, busy, onEdit, onPublish, onDelete,
}: {
  post: Post
  connections: Connection[]
  busy: boolean
  onEdit: (post: Post) => void
  onPublish: (post: Post) => void
  onDelete: (post: Post) => void
}) {
  const failed = post.targets.filter((t) => t.status === 'failed' && t.error)
  const canEdit = post.status === 'draft' || post.status === 'scheduled' || post.status === 'failed'
  const going = post.status === 'publishing'
  const first = post.targets[0]
  const firstConn = first ? connections.find((c) => c.id === first.connectionId) : undefined
  return (
    <article className="shub-row">
      <div className="shub-post-head">
        {first ? <Avatar name={first.connectionName} pictureUrl={firstConn?.pictureUrl ?? null} provider={first.provider} /> : <span className="shub-avatar"><Icon name="edit" size={14} /></span>}
        <div className="shub-post-who">
          <div className="shub-post-name">
            {post.targets.length === 0 ? 'No page chosen yet' : post.targets.length === 1 ? first!.connectionName : `${post.targets.length} pages`}
          </div>
          <div className="shub-post-when">
            {post.status === 'scheduled' || (post.scheduledAt && post.status === 'publishing')
              ? <>Goes out {fullDateTime(post.scheduledAt)}</>
              : <>Written {relativeTime(post.createdAt)}</>}
          </div>
        </div>
        <StatusPill tone={STATUS_TONE[post.status]}>{STATUS_LABEL[post.status]}</StatusPill>
      </div>
      <PostText text={post.body || (post.linkUrl ? '' : 'No text')} />
      <MediaGrid urls={post.images.map((i) => i.url)} proxy={false} />
      {post.linkUrl && post.images.length === 0 && (
        <LinkCard url={post.linkUrl} title={post.linkTitle} description={post.linkDescription} imageUrl={post.linkImageUrl} />
      )}
      {post.targets.length > 1 && (
        <div className="shub-targets">
          {post.targets.map((t) => (
            <StatusPill key={t.id} tone={t.status === 'published' ? 'ok' : t.status === 'failed' ? 'bad' : undefined}>
              {t.connectionName}{t.status === 'published' ? ' ✓' : t.status === 'failed' ? ' ✕' : ''}
            </StatusPill>
          ))}
        </div>
      )}
      {failed.map((t) => <p key={t.id} className="shub-target-error">{t.connectionName}: {t.error}</p>)}
      <div className="shub-row-actions">
        {post.targets.filter((t) => t.permalink).map((t) => <ViewLink key={t.id} href={t.permalink} provider={t.provider} />)}
        {canEdit && <button type="button" className="shub-pill shub-pill--small" disabled={busy || going} onClick={() => onEdit(post)}><Icon name="edit" size={13} /> Edit</button>}
        {(post.status === 'scheduled' || post.status === 'draft' || post.status === 'failed' || post.status === 'partial') && post.targets.length > 0 && (
          <button type="button" className="shub-pill shub-pill--small" disabled={busy || going} onClick={() => onPublish(post)}>
            <Icon name="send" size={13} /> {post.status === 'failed' || post.status === 'partial' ? 'Try again' : 'Post now'}
          </button>
        )}
        {!going && <button type="button" className="shub-pill shub-pill--small shub-pill--danger" disabled={busy} onClick={() => onDelete(post)}><Icon name="trash" size={13} /> Delete</button>}
      </div>
    </article>
  )
}
