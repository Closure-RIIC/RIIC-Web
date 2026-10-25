ALTER TABLE "app"."defense_room" ADD COLUMN "difficulty" text DEFAULT 'ac1' NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."defense_room" ADD COLUMN "team_style" text DEFAULT 'any' NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."defense_room" ADD COLUMN "communication" text DEFAULT 'any' NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."defense_room" ADD CONSTRAINT "defense_room_difficulty_check" CHECK ("app"."defense_room"."difficulty" IN ('ac1','ac2','ac3','ac4'));
--> statement-breakpoint
ALTER TABLE "app"."defense_room" ADD CONSTRAINT "defense_room_team_style_check" CHECK ("app"."defense_room"."team_style" IN ('any','newcomer','casual','clear','challenge'));
--> statement-breakpoint
ALTER TABLE "app"."defense_room" ADD CONSTRAINT "defense_room_communication_check" CHECK ("app"."defense_room"."communication" IN ('any','text','voice'));
