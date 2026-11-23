DROP INDEX "media_formats_key";--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "versions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "media_formats" ADD COLUMN "role" text DEFAULT 'format' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_formats" ADD COLUMN "version" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_targets" ADD COLUMN "versions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "post_targets" ADD COLUMN "audio_tracks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "media_formats_key" ON "media_formats" USING btree ("media_id","role","version","key");