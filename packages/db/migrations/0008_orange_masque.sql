ALTER TABLE "users" ADD COLUMN "totp_secret_encrypted" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";