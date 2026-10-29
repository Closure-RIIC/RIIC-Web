DROP INDEX "app"."release_note_environment_version_uidx";--> statement-breakpoint
DROP INDEX "app"."release_note_environment_published_idx";--> statement-breakpoint
ALTER TABLE "app"."release_note" ADD COLUMN "application" text DEFAULT 'arknights' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "release_note_application_environment_version_uidx" ON "app"."release_note" USING btree ("application","environment","version");--> statement-breakpoint
CREATE INDEX "release_note_application_environment_published_idx" ON "app"."release_note" USING btree ("application","environment","published_at");--> statement-breakpoint
ALTER TABLE "app"."release_note" ADD CONSTRAINT "release_note_application_check" CHECK ("app"."release_note"."application" IN ('arknights', 'endfield'));