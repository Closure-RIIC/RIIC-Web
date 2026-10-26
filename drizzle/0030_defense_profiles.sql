CREATE TABLE "app"."defense_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"favorite_factions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "defense_profile_factions_check" CHECK (cardinality("app"."defense_profile"."favorite_factions") <= 8 AND "app"."defense_profile"."favorite_factions" <@ ARRAY['aegir','kazimierz','laterano','sargon','victoria','kjerag','siracusa','yan']::text[])
);

--> statement-breakpoint
ALTER TABLE "app"."defense_room" DROP CONSTRAINT "defense_room_team_style_check";
--> statement-breakpoint
ALTER TABLE "app"."defense_room" DROP CONSTRAINT "defense_room_communication_check";
--> statement-breakpoint
ALTER TABLE "app"."defense_profile" ADD CONSTRAINT "defense_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."defense_room" DROP COLUMN "team_style";
--> statement-breakpoint
ALTER TABLE "app"."defense_room" DROP COLUMN "communication";
