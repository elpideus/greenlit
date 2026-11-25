CREATE TABLE "media_slides" (
	"slides_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_slides_slides_id_media_id_pk" PRIMARY KEY("slides_id","media_id")
);
--> statement-breakpoint
ALTER TABLE "media_slides" ADD CONSTRAINT "media_slides_slides_id_media_id_fk" FOREIGN KEY ("slides_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_slides" ADD CONSTRAINT "media_slides_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_slides_media" ON "media_slides" USING btree ("media_id");