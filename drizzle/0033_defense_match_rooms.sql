ALTER TABLE "app"."defense_room" ALTER COLUMN "room_code" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "app"."defense_room" ADD COLUMN "invite_code" text;
--> statement-breakpoint
UPDATE "app"."defense_room" SET "invite_code"='R-' || "id";
--> statement-breakpoint
ALTER TABLE "app"."defense_room" ALTER COLUMN "invite_code" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "defense_room_invite_code_idx" ON "app"."defense_room" USING btree ("invite_code");