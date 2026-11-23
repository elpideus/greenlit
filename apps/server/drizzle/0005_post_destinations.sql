CREATE TABLE "project_post_destinations" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_post_destinations" ADD CONSTRAINT "project_post_destinations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;