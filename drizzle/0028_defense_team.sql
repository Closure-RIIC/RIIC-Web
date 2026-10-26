CREATE TABLE "app"."defense_room" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"title" text NOT NULL,
	"server" text NOT NULL,
	"room_code" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '2 hours' NOT NULL,
	CONSTRAINT "defense_room_server_check" CHECK ("app"."defense_room"."server" IN ('official','bilibili')),
	CONSTRAINT "defense_room_status_check" CHECK ("app"."defense_room"."status" IN ('open','started','closed'))
);

--> statement-breakpoint
CREATE TABLE "app"."defense_member" (
	"user_id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "app"."defense_room" ADD CONSTRAINT "defense_room_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."defense_member" ADD CONSTRAINT "defense_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."defense_member" ADD CONSTRAINT "defense_member_room_id_defense_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "app"."defense_room"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "defense_room_lobby_idx" ON "app"."defense_room" USING btree ("server","status","expires_at");
--> statement-breakpoint
CREATE INDEX "defense_member_room_idx" ON "app"."defense_member" USING btree ("room_id");
