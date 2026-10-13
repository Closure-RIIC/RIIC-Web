ALTER TABLE "app"."billing_cdk" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "app"."billing_cdk" ADD COLUMN "batch_label" text;--> statement-breakpoint
ALTER TABLE "app"."billing_cdk" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."billing_cdk" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."billing_cdk" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."billing_cdk" ADD COLUMN "revoked_by" text;--> statement-breakpoint
ALTER TABLE "app"."billing_cdk" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "app"."billing_cdk" ADD CONSTRAINT "billing_cdk_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_cdk_batch_idx" ON "app"."billing_cdk" USING btree ("batch_id");