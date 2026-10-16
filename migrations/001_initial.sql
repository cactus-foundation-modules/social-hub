-- Social Hub: the app credentials the owner typed in, the Facebook Pages and
-- LinkedIn Pages they have connected, the posts written here (drafts, scheduled,
-- published) and a cache of what is already on each page so the feed opens
-- instantly. All DDL is idempotent so run-module-migrations can safely re-apply it.

CREATE TABLE IF NOT EXISTS "shub_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    -- Facebook (Meta) app. The secret is stored encrypted with ENCRYPTION_KEY.
    "fb_app_id" TEXT,
    "fb_app_secret_enc" TEXT,
    -- Only for apps whose login is "Facebook Login for Business": that variety
    -- asks for a configuration ID instead of a list of permissions.
    "fb_config_id" TEXT,
    -- LinkedIn developer app.
    "li_client_id" TEXT,
    "li_client_secret_enc" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shub_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shub_settings_singleton_check" CHECK ("id" = 'singleton')
);
INSERT INTO "shub_settings" ("id") VALUES ('singleton') ON CONFLICT DO NOTHING;

-- One row per Facebook Page or LinkedIn Page we can post to.
CREATE TABLE IF NOT EXISTS "shub_connections" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "provider" TEXT NOT NULL,
    -- Facebook page id, or LinkedIn organisation id (digits only).
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "picture_url" TEXT,
    "profile_url" TEXT,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "token_expires_at" TIMESTAMPTZ,
    "refresh_expires_at" TIMESTAMPTZ,
    -- needs_reauth: the network refused our token (password changed, access
    -- removed, token expired). Posting stops until the owner reconnects.
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_error" TEXT,
    "last_synced_at" TIMESTAMPTZ,
    "connected_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shub_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shub_connections_provider_check" CHECK ("provider" IN ('facebook', 'linkedin')),
    CONSTRAINT "shub_connections_status_check" CHECK ("status" IN ('active', 'needs_reauth')),
    CONSTRAINT "shub_connections_unique" UNIQUE ("provider", "external_id")
);

-- A post written in Social Hub. One post fans out to one target per page.
CREATE TABLE IF NOT EXISTS "shub_posts" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "body" TEXT NOT NULL DEFAULT '',
    "link_url" TEXT,
    "link_title" TEXT,
    "link_description" TEXT,
    "link_image_url" TEXT,
    -- [{ "url": "...", "alt": "..." }]
    "images" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduled_at" TIMESTAMPTZ,
    "published_at" TIMESTAMPTZ,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shub_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shub_posts_status_check"
        CHECK ("status" IN ('draft', 'scheduled', 'publishing', 'published', 'partial', 'failed'))
);
CREATE INDEX IF NOT EXISTS "shub_posts_status_idx" ON "shub_posts" ("status", "scheduled_at");

CREATE TABLE IF NOT EXISTS "shub_post_targets" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "post_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "external_id" TEXT,
    "permalink" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ,
    CONSTRAINT "shub_post_targets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shub_post_targets_status_check"
        CHECK ("status" IN ('pending', 'publishing', 'published', 'failed')),
    CONSTRAINT "shub_post_targets_unique" UNIQUE ("post_id", "connection_id"),
    CONSTRAINT "shub_post_targets_post_fk"
        FOREIGN KEY ("post_id") REFERENCES "shub_posts" ("id") ON DELETE CASCADE,
    CONSTRAINT "shub_post_targets_connection_fk"
        FOREIGN KEY ("connection_id") REFERENCES "shub_connections" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "shub_post_targets_external_idx" ON "shub_post_targets" ("connection_id", "external_id");

-- What is on each page already, as last read from the network.
CREATE TABLE IF NOT EXISTS "shub_remote_posts" (
    "connection_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "permalink" TEXT,
    "image_urls" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "link_url" TEXT,
    "link_title" TEXT,
    "posted_at" TIMESTAMPTZ,
    "like_count" INTEGER,
    "comment_count" INTEGER,
    "share_count" INTEGER,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shub_remote_posts_pkey" PRIMARY KEY ("connection_id", "external_id"),
    CONSTRAINT "shub_remote_posts_connection_fk"
        FOREIGN KEY ("connection_id") REFERENCES "shub_connections" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "shub_remote_posts_posted_idx" ON "shub_remote_posts" ("posted_at" DESC);
