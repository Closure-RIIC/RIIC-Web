ALTER TABLE "app"."agent_model_call" ALTER COLUMN "budget_points" SET DATA TYPE numeric(15, 4);--> statement-breakpoint
ALTER TABLE "app"."agent_run" ALTER COLUMN "held_paid" SET DATA TYPE numeric(15, 4);--> statement-breakpoint
ALTER TABLE "app"."agent_run" ALTER COLUMN "held_monthly" SET DATA TYPE numeric(15, 4);--> statement-breakpoint
ALTER TABLE "app"."agent_run" ALTER COLUMN "charged_points" SET DATA TYPE numeric(15, 4);--> statement-breakpoint
ALTER TABLE "app"."agent_usage" ALTER COLUMN "points" SET DATA TYPE numeric(15, 4);--> statement-breakpoint
ALTER TABLE "app"."agent_usage" ALTER COLUMN "upstream_cost_rmb_fen" SET DATA TYPE numeric(24, 10);--> statement-breakpoint
ALTER TABLE "app"."agent_usage" ALTER COLUMN "charged_cost_rmb_fen" SET DATA TYPE numeric(24, 10);--> statement-breakpoint
ALTER TABLE "app"."billing_ledger" ALTER COLUMN "points_delta" SET DATA TYPE numeric(15, 4);--> statement-breakpoint
ALTER TABLE "app"."billing_ledger" ALTER COLUMN "paid_points_after" SET DATA TYPE numeric(15, 4);--> statement-breakpoint
ALTER TABLE "app"."billing_ledger" ALTER COLUMN "monthly_points_after" SET DATA TYPE numeric(15, 4);--> statement-breakpoint
ALTER TABLE "app"."billing_wallet" ALTER COLUMN "paid_points" SET DATA TYPE numeric(15, 4);--> statement-breakpoint
ALTER TABLE "app"."billing_wallet" ALTER COLUMN "monthly_points" SET DATA TYPE numeric(15, 4);--> statement-breakpoint
ALTER TABLE "app"."billing_wallet" ALTER COLUMN "held_paid_points" SET DATA TYPE numeric(15, 4);--> statement-breakpoint
ALTER TABLE "app"."billing_wallet" ALTER COLUMN "held_monthly_points" SET DATA TYPE numeric(15, 4);