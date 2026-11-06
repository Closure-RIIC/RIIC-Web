CREATE TABLE "app"."agent_tool_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"computation_state" text DEFAULT 'unknown' NOT NULL,
	"processing_state" text DEFAULT 'unknown' NOT NULL,
	"error_code" text,
	"wait_error_code" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tool_execution_state_check" CHECK ("app"."agent_tool_execution"."state" IN ('running','succeeded','failed','timed_out','cancelled','unknown')),
	CONSTRAINT "agent_tool_execution_computation_check" CHECK ("app"."agent_tool_execution"."computation_state" IN ('unknown','running','succeeded','failed')),
	CONSTRAINT "agent_tool_execution_processing_check" CHECK ("app"."agent_tool_execution"."processing_state" IN ('unknown','succeeded','failed'))
);
--> statement-breakpoint
ALTER TABLE "app"."agent_tool_execution" ADD CONSTRAINT "agent_tool_execution_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tool_execution_call_idx" ON "app"."agent_tool_execution" USING btree ("run_id","tool_call_id");--> statement-breakpoint
CREATE INDEX "agent_tool_execution_run_idx" ON "app"."agent_tool_execution" USING btree ("run_id","created_at");