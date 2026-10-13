CREATE TABLE IF NOT EXISTS "app"."wish" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "admin_note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "wish_status_created_at_idx" ON "app"."wish" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "wish_user_created_at_idx" ON "app"."wish" ("user_id", "created_at");
ALTER TABLE "app"."wish" ADD COLUMN IF NOT EXISTS "image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;
CREATE TABLE IF NOT EXISTS "app"."site_setting" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
