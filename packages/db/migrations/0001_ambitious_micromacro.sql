CREATE TABLE IF NOT EXISTS "login_tokens" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "login_tokens_token_hash_idx" ON "login_tokens" USING btree ("token_hash");