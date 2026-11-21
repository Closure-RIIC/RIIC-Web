CREATE TABLE "app"."agent_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"title" text NOT NULL,
	"next_sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."agent_conversation_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"request_id" text NOT NULL,
	"action" text NOT NULL,
	"scope" jsonb NOT NULL,
	"result" text NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."agent_conversation_turn" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"attempt_id" text NOT NULL,
	"request_id" text NOT NULL,
	"run_id" text,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"user_message" jsonb NOT NULL,
	"assistant_message" jsonb,
	"user_text" text NOT NULL,
	"assistant_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "agent_conversation_turn_status_check" CHECK ("app"."agent_conversation_turn"."status" IN ('streaming','completed','cancelled','failed','interrupted'))
);
--> statement-breakpoint
ALTER TABLE "app"."agent_conversation" ADD CONSTRAINT "agent_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_conversation_turn" ADD CONSTRAINT "agent_conversation_turn_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."agent_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_conversation_turn" ADD CONSTRAINT "agent_conversation_turn_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversation_owner_client_idx" ON "app"."agent_conversation" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "agent_conversation_owner_updated_idx" ON "app"."agent_conversation" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversation_turn_attempt_idx" ON "app"."agent_conversation_turn" USING btree ("user_id","attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversation_turn_sequence_idx" ON "app"."agent_conversation_turn" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "agent_conversation_turn_export_idx" ON "app"."agent_conversation_turn" USING btree ("created_at","id");