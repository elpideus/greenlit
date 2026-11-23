CREATE TABLE "place_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"place_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"kind" text,
	"country" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"search_text" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "place_links" ADD CONSTRAINT "place_links_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "place_links_unique" ON "place_links" USING btree ("place_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "place_links_entity" ON "place_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "places_lat_lng" ON "places" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "places_source_id" ON "places" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "places_search_trgm" ON "places" USING gin ("search_text" gin_trgm_ops);