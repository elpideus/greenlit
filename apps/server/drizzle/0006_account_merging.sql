ALTER TABLE "connector_accounts" ADD COLUMN "sign_in" jsonb;--> statement-breakpoint
ALTER TABLE "connector_accounts" ADD COLUMN "merged_into" uuid;--> statement-breakpoint
ALTER TABLE "post_targets" ADD COLUMN "via_account_id" uuid;