CREATE TABLE "connector_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"platform" text NOT NULL,
	"driver" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"handle" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"avatar_version" text,
	"profile_url" text,
	"state" text DEFAULT 'connecting' NOT NULL,
	"state_message" text,
	"capabilities" jsonb NOT NULL,
	"platform_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"session_dir" text NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_media" (
	"post_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "post_media_post_id_media_id_pk" PRIMARY KEY("post_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "post_targets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"post_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"placement" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"title" text,
	"caption" text,
	"hashtags" text[],
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_comment" text DEFAULT '' NOT NULL,
	"location" jsonb,
	"thumbnail" jsonb DEFAULT '{"mode":"auto"}'::jsonb NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"music" jsonb,
	"audio" jsonb DEFAULT '{"original":1,"music":1}'::jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"formats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule_at" timestamp with time zone,
	"state" text DEFAULT 'draft' NOT NULL,
	"remote_id" text,
	"remote_url" text,
	"error" text,
	"published_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"stats" jsonb,
	"remote_snapshot" jsonb,
	"prepared_blob_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"prepared_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin" text DEFAULT 'greenlit' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_accounts_external" ON "connector_accounts" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "connector_accounts_session" ON "connector_accounts" USING btree ("session_dir");--> statement-breakpoint
CREATE INDEX "post_media_media" ON "post_media" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "post_targets_post" ON "post_targets" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_targets_schedule" ON "post_targets" USING btree ("schedule_at");--> statement-breakpoint
CREATE INDEX "post_targets_remote" ON "post_targets" USING btree ("account_id","remote_id");--> statement-breakpoint
CREATE INDEX "posts_project" ON "posts" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_links_target" ON "share_links" USING btree ("target_id");