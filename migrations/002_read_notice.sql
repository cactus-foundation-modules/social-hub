-- What a network refused to share on the last read of a page. Not an error (the posts
-- were read) but a gap the owner should be told about: no links, no like counts. NULL
-- when the last read got everything asked for. Idempotent so it can be re-applied.
ALTER TABLE "shub_connections" ADD COLUMN IF NOT EXISTS "read_notice" TEXT;
