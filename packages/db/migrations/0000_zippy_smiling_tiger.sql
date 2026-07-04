CREATE TABLE IF NOT EXISTS "accounts" (
	"number" bigint PRIMARY KEY NOT NULL,
	"user_id" varchar(26) NOT NULL,
	"nickname" varchar(30) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"tier" varchar(20) DEFAULT 'free' NOT NULL,
	"allow_stranger_contact" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_cards" (
	"number" bigint PRIMARY KEY NOT NULL,
	"description" text,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"org_name" text,
	"org_url" text,
	"languages" text[] DEFAULT '{}' NOT NULL,
	"visibility" varchar(10) DEFAULT 'public' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contacts" (
	"a_number" bigint NOT NULL,
	"b_number" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "friend_requests" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"from_number" bigint NOT NULL,
	"to_number" bigint NOT NULL,
	"intro" varchar(100) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"from_number" bigint NOT NULL,
	"to_number" bigint NOT NULL,
	"thread_id" varchar(26) NOT NULL,
	"subject" text,
	"body" jsonb NOT NULL,
	"status" varchar(10) DEFAULT 'unread' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "number_pool" (
	"id" varchar(8) PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"next_number" bigint DEFAULT 10000 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_clients" (
	"client_id" varchar(64) PRIMARY KEY NOT NULL,
	"client_secret_hash" text,
	"client_name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"grant_types" text[] DEFAULT '{"authorization_code"}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_tokens" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"user_id" varchar(26) NOT NULL,
	"access_token_hash" text NOT NULL,
	"refresh_token_hash" text,
	"scope" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"locale" varchar(5) DEFAULT 'zh' NOT NULL,
	"notify_email" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_cards" ADD CONSTRAINT "agent_cards_number_accounts_number_fk" FOREIGN KEY ("number") REFERENCES "public"."accounts"("number") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_pair_idx" ON "contacts" USING btree ("a_number","b_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "friend_requests_to_status_idx" ON "friend_requests" USING btree ("to_number","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "friend_requests_from_status_idx" ON "friend_requests" USING btree ("from_number","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_to_status_idx" ON "messages" USING btree ("to_number","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_thread_idx" ON "messages" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_tokens_access_token_idx" ON "oauth_tokens" USING btree ("access_token_hash");