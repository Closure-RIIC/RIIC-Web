ALTER TABLE app.defense_profile DROP CONSTRAINT defense_profile_portrait_check;
--> statement-breakpoint
ALTER TABLE app.defense_profile ADD CONSTRAINT defense_profile_portrait_check CHECK (portrait IN ('default','portrait-1','portrait-2') OR portrait ~ '^char_[a-z0-9_]{1,64}$');
