CREATE TABLE "app"."agent_filter_event" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"user_id" text,
	"version" text NOT NULL,
	"stage" text NOT NULL,
	"rule_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."agent_gateway_status" (
	"id" text PRIMARY KEY NOT NULL,
	"filter_version" text,
	"status" text NOT NULL,
	"details" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."agent_gateway_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"provider" text,
	"model" text,
	"call_id" text,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."agent_model_call" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"step" integer NOT NULL,
	"provider" text,
	"model" text,
	"gateway_request_id" text,
	"status" text DEFAULT 'started' NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_input_tokens" integer,
	"upstream_rmb" numeric(24, 12),
	"charged_rmb" numeric(24, 12),
	"budget_points" integer NOT NULL,
	"rate_version" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."agent_policy_version" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payload" jsonb NOT NULL,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "agent_policy_kind" CHECK ("app"."agent_policy_version"."kind" in ('rates','filter')),
	CONSTRAINT "agent_policy_status" CHECK ("app"."agent_policy_version"."status" in ('draft','active','retired'))
);
--> statement-breakpoint
CREATE TABLE "app"."agent_run" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"conversation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"settlement" text DEFAULT 'reserved' NOT NULL,
	"policy" jsonb NOT NULL,
	"rate_version" text NOT NULL,
	"filter_version" text NOT NULL,
	"held_paid" integer DEFAULT 0 NOT NULL,
	"held_monthly" integer DEFAULT 0 NOT NULL,
	"monthly_expires_at" timestamp with time zone,
	"charged_points" integer DEFAULT 0 NOT NULL,
	"tool_points" integer DEFAULT 0 NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "agent_run_nonnegative" CHECK ("app"."agent_run"."held_paid" >= 0 and "app"."agent_run"."held_monthly" >= 0 and "app"."agent_run"."charged_points" >= 0 and "app"."agent_run"."tool_points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."agent_tool_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."billing_admin_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."billing_review" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"evidence" jsonb NOT NULL,
	"resolution" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."billing_wallet" ADD COLUMN "held_paid_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."billing_wallet" ADD COLUMN "held_monthly_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."agent_filter_event" ADD CONSTRAINT "agent_filter_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_gateway_usage" ADD CONSTRAINT "agent_gateway_usage_call_id_agent_model_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "app"."agent_model_call"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_model_call" ADD CONSTRAINT "agent_model_call_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."agent_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_policy_version" ADD CONSTRAINT "agent_policy_version_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_run" ADD CONSTRAINT "agent_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_tool_charge" ADD CONSTRAINT "agent_tool_charge_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."agent_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."billing_admin_audit" ADD CONSTRAINT "billing_admin_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."billing_review" ADD CONSTRAINT "billing_review_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."agent_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."billing_review" ADD CONSTRAINT "billing_review_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_filter_event_created" ON "app"."agent_filter_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_gateway_usage_call" ON "app"."agent_gateway_usage" USING btree ("call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_model_call_run_step" ON "app"."agent_model_call" USING btree ("run_id","step");--> statement-breakpoint
CREATE INDEX "agent_model_call_created" ON "app"."agent_model_call" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_model_call_model_created" ON "app"."agent_model_call" USING btree ("model","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_policy_version_kind_version" ON "app"."agent_policy_version" USING btree ("kind","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_policy_one_active" ON "app"."agent_policy_version" USING btree ("kind") WHERE "app"."agent_policy_version"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_owner_idempotency" ON "app"."agent_run" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_run_owner_created" ON "app"."agent_run" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_run_settlement_heartbeat" ON "app"."agent_run" USING btree ("settlement","heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tool_charge_run_call" ON "app"."agent_tool_charge" USING btree ("run_id","tool_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_admin_audit_idempotency" ON "app"."billing_admin_audit" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "billing_admin_audit_created" ON "app"."billing_admin_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "billing_review_status_created" ON "app"."billing_review" USING btree ("status","created_at");