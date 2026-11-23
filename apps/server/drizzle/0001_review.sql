CREATE TABLE "comment_attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"comment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"media_id" uuid,
	"format_id" uuid,
	"blob_id" uuid,
	"name" text,
	"mime" text,
	"size" bigint,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"format_id" uuid,
	"parent_id" uuid,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"pin" jsonb,
	"time" real,
	"frame" integer,
	"file_revision" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"from_type" text NOT NULL,
	"from_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"to_type" text NOT NULL,
	"to_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"auto" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"actor_id" uuid,
	"entity_type" text,
	"entity_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_assignments" (
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"decision" text,
	"note" text DEFAULT '' NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "review_assignments_request_id_user_id_pk" PRIMARY KEY("request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"media_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_request_id_review_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_attachments_comment" ON "comment_attachments" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "comment_attachments_blob" ON "comment_attachments" USING btree ("blob_id");--> statement-breakpoint
CREATE INDEX "comments_target" ON "comments" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "comments_parent" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "links_unique" ON "links" USING btree ("from_type","from_id","relation","to_type","to_id");--> statement-breakpoint
CREATE INDEX "links_from" ON "links" USING btree ("from_type","from_id");--> statement-breakpoint
CREATE INDEX "links_to" ON "links" USING btree ("to_type","to_id");--> statement-breakpoint
CREATE INDEX "notifications_user" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "review_assignments_user" ON "review_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "review_requests_media" ON "review_requests" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "review_requests_status" ON "review_requests" USING btree ("status");