ALTER TABLE "cards" ADD COLUMN "sign_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "execution_status" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "status_detail" jsonb;