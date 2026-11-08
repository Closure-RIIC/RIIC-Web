CREATE TABLE "app"."billing_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"custom_order_id" text,
	"amount_fen" integer,
	"provider_status" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"order_id" text,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."billing_reconciliation" (
	"provider" text PRIMARY KEY NOT NULL,
	"next_page" integer DEFAULT 1 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."billing_payment" ADD CONSTRAINT "billing_payment_order_id_billing_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."billing_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_payment_provider_trade_uidx" ON "app"."billing_payment" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE INDEX "billing_payment_status_created_idx" ON "app"."billing_payment" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_order_provider_trade_uidx" ON "app"."billing_order" USING btree ("provider","provider_order_id");