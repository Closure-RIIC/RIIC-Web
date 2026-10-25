ALTER TABLE "app"."defense_member" ADD COLUMN "seat" integer;--> statement-breakpoint
ALTER TABLE "app"."defense_member" ADD COLUMN "is_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
WITH positions AS (
 SELECT m.user_id, (row_number() OVER (PARTITION BY m.room_id ORDER BY (m.user_id=r.host_id) DESC,m.joined_at,m.user_id)-1)::integer AS seat
 FROM "app"."defense_member" m JOIN "app"."defense_room" r ON r.id=m.room_id
)
UPDATE "app"."defense_member" m SET "seat"=positions.seat FROM positions WHERE positions.user_id=m.user_id;
--> statement-breakpoint
ALTER TABLE "app"."defense_member" ALTER COLUMN "seat" SET NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX "defense_member_room_seat_idx" ON "app"."defense_member" USING btree ("room_id","seat");--> statement-breakpoint
ALTER TABLE "app"."defense_member" ADD CONSTRAINT "defense_member_seat_check" CHECK ("app"."defense_member"."seat" BETWEEN 0 AND 3);