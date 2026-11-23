CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"author_id" uuid,
	"source" text DEFAULT 'web' NOT NULL,
	"changed" text[] DEFAULT '{}'::text[] NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"name" text,
	"note" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"created_by" uuid,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sha256" text,
	"size" bigint NOT NULL,
	"mime" text NOT NULL,
	"filename" text NOT NULL,
	"state" text DEFAULT 'hot' NOT NULL,
	"path" text NOT NULL,
	"archive_strategy" text,
	"archived_path" text,
	"archived_size" bigint,
	"archived_mime" text,
	"archived_at" timestamp with time zone,
	"usage" text DEFAULT 'media' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"origin" text DEFAULT 'upload' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"taken_at" timestamp with time zone,
	"hidden_from" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"media_id" uuid NOT NULL,
	"format_id" uuid NOT NULL,
	"blob_id" uuid NOT NULL,
	"file_revision" integer NOT NULL,
	"filename" text NOT NULL,
	"size" bigint NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_formats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"media_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"blob_id" uuid NOT NULL,
	"file_revision" integer DEFAULT 1 NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"filename" text NOT NULL,
	"size" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"duration" real,
	"fps" real,
	"has_audio" boolean DEFAULT false NOT NULL,
	"processing_state" text DEFAULT 'pending' NOT NULL,
	"processing_progress" real DEFAULT 0 NOT NULL,
	"processing_error" text,
	"derived" text[] DEFAULT '{}'::text[] NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text,
	"cover_media_id" uuid,
	"hidden_from" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'web' NOT NULL,
	"share_link_id" uuid,
	"share_target_type" text,
	"share_target_id" uuid,
	"user_agent" text,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_path" text,
	"role" text DEFAULT 'reviewer' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_formats" ADD CONSTRAINT "media_formats_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_entity_seq" ON "revisions" USING btree ("entity_type","entity_id","seq");--> statement-breakpoint
CREATE INDEX "revisions_author" ON "revisions" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "tasks_entity" ON "tasks" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "tasks_state" ON "tasks" USING btree ("state");--> statement-breakpoint
CREATE INDEX "blobs_sha" ON "blobs" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "blobs_state" ON "blobs" USING btree ("state");--> statement-breakpoint
CREATE INDEX "blobs_usage" ON "blobs" USING btree ("usage");--> statement-breakpoint
CREATE INDEX "media_project" ON "media" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "media_created" ON "media" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "media_tags" ON "media" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "media_search_trgm" ON "media" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "media_files_format" ON "media_files" USING btree ("format_id");--> statement-breakpoint
CREATE INDEX "media_files_blob" ON "media_files" USING btree ("blob_id");--> statement-breakpoint
CREATE INDEX "media_files_media" ON "media_files" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_formats_key" ON "media_formats" USING btree ("media_id","key");--> statement-breakpoint
CREATE INDEX "media_formats_blob" ON "media_formats" USING btree ("blob_id");--> statement-breakpoint
CREATE INDEX "projects_name_trgm" ON "projects" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_user" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email" ON "users" USING btree (lower("email"));