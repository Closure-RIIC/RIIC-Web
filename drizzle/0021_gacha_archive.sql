CREATE TABLE "app"."gacha_archive" (
	"uid" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"nickname" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"saved_at" timestamp with time zone,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."gacha_draw" (
	"uid" text NOT NULL,
	"draw_key" text NOT NULL,
	"record" jsonb NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "gacha_draw_source_check" CHECK ("app"."gacha_draw"."source" IN ('official', 'browser'))
);
--> statement-breakpoint
ALTER TABLE "app"."gacha_archive" ADD CONSTRAINT "gacha_archive_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."gacha_draw" ADD CONSTRAINT "gacha_draw_uid_gacha_archive_uid_fk" FOREIGN KEY ("uid") REFERENCES "app"."gacha_archive"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gacha_archive_user_idx" ON "app"."gacha_archive" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gacha_draw_uid_key_idx" ON "app"."gacha_draw" USING btree ("uid","draw_key");