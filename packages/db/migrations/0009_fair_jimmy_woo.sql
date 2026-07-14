ALTER TABLE "accounts" ADD COLUMN "auto_reply_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "auto_accept_friend_requests_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "auto_send_messages_enabled" boolean DEFAULT false NOT NULL;