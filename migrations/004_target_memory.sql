-- Disconnecting a page deletes its post targets (cascade), which silently left
-- every unsent post aimed at nothing. Before a page goes, the pages it was
-- still owed to are remembered here, and reconnecting the same page gives them
-- back. Keyed on provider + external id because the connection row id changes.
-- Idempotent so run-module-migrations can safely re-apply it.
CREATE TABLE IF NOT EXISTS "shub_target_memory" (
    "post_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shub_target_memory_pkey" PRIMARY KEY ("post_id", "provider", "external_id"),
    CONSTRAINT "shub_target_memory_post_fk"
        FOREIGN KEY ("post_id") REFERENCES "shub_posts" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "shub_target_memory_page_idx" ON "shub_target_memory" ("provider", "external_id");
