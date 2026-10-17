-- A post can follow something else on the site that goes live: a Gazette article
-- today. It waits as a draft until that thing is published or scheduled, then goes
-- out with it. source_at is the owner's own time for it, when they want it later
-- than the article; NULL means "when the article goes live". One post per source.
-- Idempotent so run-module-migrations can safely re-apply it.
ALTER TABLE "shub_posts" ADD COLUMN IF NOT EXISTS "source_kind" TEXT;
ALTER TABLE "shub_posts" ADD COLUMN IF NOT EXISTS "source_id" TEXT;
ALTER TABLE "shub_posts" ADD COLUMN IF NOT EXISTS "source_at" TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS "shub_posts_source_unique"
    ON "shub_posts" ("source_kind", "source_id") WHERE "source_kind" IS NOT NULL;
