ALTER TABLE "app"."agent_model_call" ADD COLUMN "cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "app"."agent_usage" ADD COLUMN "cache_write_tokens" integer;