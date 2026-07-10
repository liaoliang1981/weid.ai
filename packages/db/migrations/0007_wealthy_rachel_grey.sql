DROP INDEX IF EXISTS "users_recovery_code_hash_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "recovery_code_hash";