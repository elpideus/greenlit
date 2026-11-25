ALTER TABLE "media" ADD COLUMN "web_links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "web_links" jsonb DEFAULT '[]'::jsonb NOT NULL;