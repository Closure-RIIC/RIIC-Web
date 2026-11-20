CREATE TABLE "app"."referral_code" (
	"user_id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."referral_identity" (
	"binding_key" text PRIMARY KEY NOT NULL,
	"first_user_id" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."referral_registration" (
	"id" text PRIMARY KEY NOT NULL,
	"inviter_user_id" text NOT NULL,
	"invitee_user_id" text NOT NULL,
	"binding_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"qualified_at" timestamp with time zone,
	"rewarded_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "referral_registration_not_self" CHECK ("app"."referral_registration"."inviter_user_id" <> "app"."referral_registration"."invitee_user_id"),
	CONSTRAINT "referral_registration_status" CHECK ("app"."referral_registration"."status" in ('pending','qualified','rewarded','rejected','capped')),
	CONSTRAINT "referral_registration_reward" CHECK (("app"."referral_registration"."status" = 'rewarded' and "app"."referral_registration"."points" = 10 and "app"."referral_registration"."rewarded_at" is not null and "app"."referral_registration"."qualified_at" is not null) or ("app"."referral_registration"."status" <> 'rewarded' and "app"."referral_registration"."points" = 0 and "app"."referral_registration"."rewarded_at" is null))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "signup_referral_code" text;--> statement-breakpoint
ALTER TABLE "app"."referral_code" ADD CONSTRAINT "referral_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_code_unique" ON "app"."referral_code" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_registration_invitee_unique" ON "app"."referral_registration" USING btree ("invitee_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_registration_identity_unique" ON "app"."referral_registration" USING btree ("binding_key");--> statement-breakpoint
CREATE INDEX "referral_registration_inviter_idx" ON "app"."referral_registration" USING btree ("inviter_user_id","created_at");--> statement-breakpoint
INSERT INTO "app"."site_setting" ("key", "value") VALUES ('agent_referral', '{"enabled":false}'::jsonb) ON CONFLICT ("key") DO NOTHING;
