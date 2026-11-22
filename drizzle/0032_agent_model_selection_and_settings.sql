ALTER TABLE "app"."agent_policy_version" DROP CONSTRAINT "agent_policy_kind";--> statement-breakpoint
ALTER TABLE "app"."agent_run" ADD COLUMN IF NOT EXISTS "model_selection" jsonb;--> statement-breakpoint
ALTER TABLE "app"."agent_policy_version" ADD CONSTRAINT "agent_policy_kind" CHECK ("app"."agent_policy_version"."kind" in ('rates','filter','resources','models','model-settings'));
