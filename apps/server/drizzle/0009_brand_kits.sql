CREATE TABLE "brand_assets" (
	"media_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"section" text NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"placed_by" text DEFAULT 'auto' NOT NULL,
	"info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"guide" text DEFAULT '' NOT NULL,
	"colors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fonts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logo_media_id" uuid,
	"unpacking" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "kind" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_assets_project" ON "brand_assets" USING btree ("project_id");