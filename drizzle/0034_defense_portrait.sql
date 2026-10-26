ALTER TABLE app.defense_profile ADD COLUMN portrait text DEFAULT 'default' NOT NULL;
ALTER TABLE app.defense_profile ADD CONSTRAINT defense_profile_portrait_check CHECK (portrait IN ('default','portrait-1','portrait-2'));
