CREATE TABLE "composition_ops" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"composition_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"ops" jsonb NOT NULL,
	"author_id" uuid,
	"source" text NOT NULL,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compositions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"document" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"output_media_id" uuid,
	"poster_revision" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "composition_ops" ADD CONSTRAINT "composition_ops_composition_id_compositions_id_fk" FOREIGN KEY ("composition_id") REFERENCES "public"."compositions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "compositions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "composition_ops_rev" ON "composition_ops" USING btree ("composition_id","revision");--> statement-breakpoint
CREATE INDEX "compositions_project" ON "compositions" USING btree ("project_id");