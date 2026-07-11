import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: varchar("id", { length: 26 }).primaryKey(), // ulid
  // AES-256-GCM ciphertext (iv:data:tag, hex) of the user's TOTP secret, keyed
  // off SESSION_SECRET. The number is public (meant to be shared), so it
  // can't double as a login secret; login is number + current 6-digit
  // authenticator code, looked up by number, not by this column.
  totpSecretEncrypted: text("totp_secret_encrypted").notNull(),
  locale: varchar("locale", { length: 5 }).notNull().default("zh"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const numberPool = pgTable("number_pool", {
  id: varchar("id", { length: 16 }).primaryKey().default("singleton"),
  nextNumber: bigint("next_number", { mode: "bigint" }).notNull().default(sql`10000`),
});

export const accountStatusValues = ["active", "suspended"] as const;
export const accountTierValues = ["free", "verified_person", "verified_business"] as const;

export const accounts = pgTable("accounts", {
  number: bigint("number", { mode: "bigint" }).primaryKey(),
  userId: varchar("user_id", { length: 26 })
    .notNull()
    .unique()
    .references(() => users.id),
  nickname: varchar("nickname", { length: 30 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  tier: varchar("tier", { length: 20 }).notNull().default("free"),
  // Reserved for future enterprise-verified numbers; always false in this phase.
  allowStrangerContact: boolean("allow_stranger_contact").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contacts = pgTable(
  "contacts",
  {
    aNumber: bigint("a_number", { mode: "bigint" }).notNull(),
    bNumber: bigint("b_number", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // a_number < b_number enforced at the application layer to keep the pair unique.
    pairIdx: uniqueIndex("contacts_pair_idx").on(table.aNumber, table.bNumber),
  }),
);

export const friendRequestStatusValues = ["pending", "accepted", "rejected", "expired"] as const;

export const friendRequests = pgTable(
  "friend_requests",
  {
    id: varchar("id", { length: 26 }).primaryKey(), // ulid
    fromNumber: bigint("from_number", { mode: "bigint" }).notNull(),
    toNumber: bigint("to_number", { mode: "bigint" }).notNull(),
    intro: varchar("intro", { length: 100 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => ({
    toStatusIdx: index("friend_requests_to_status_idx").on(table.toNumber, table.status),
    fromStatusIdx: index("friend_requests_from_status_idx").on(table.fromNumber, table.status),
  }),
);

export const agentCardVisibilityValues = ["public", "unlisted"] as const;

export const agentCards = pgTable("agent_cards", {
  number: bigint("number", { mode: "bigint" })
    .primaryKey()
    .references(() => accounts.number),
  description: text("description"),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  orgName: text("org_name"),
  orgUrl: text("org_url"),
  languages: text("languages").array().notNull().default([]),
  visibility: varchar("visibility", { length: 10 }).notNull().default("public"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messageStatusValues = ["unread", "read", "archived"] as const;

export const messages = pgTable(
  "messages",
  {
    id: varchar("id", { length: 26 }).primaryKey(), // ulid
    fromNumber: bigint("from_number", { mode: "bigint" }).notNull(),
    toNumber: bigint("to_number", { mode: "bigint" }).notNull(),
    threadId: varchar("thread_id", { length: 26 }).notNull(),
    subject: text("subject"),
    body: jsonb("body").notNull(), // see CLAUDE.md §5 for the weid.msg.v1 shape
    status: varchar("status", { length: 10 }).notNull().default("unread"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    toStatusIdx: index("messages_to_status_idx").on(table.toNumber, table.status),
    threadIdx: index("messages_thread_idx").on(table.threadId),
  }),
);

export const oauthClients = pgTable("oauth_clients", {
  clientId: varchar("client_id", { length: 64 }).primaryKey(),
  clientSecretHash: text("client_secret_hash"),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  grantTypes: text("grant_types").array().notNull().default(["authorization_code"]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: varchar("id", { length: 26 }).primaryKey(), // ulid
    clientId: varchar("client_id", { length: 64 })
      .notNull()
      .references(() => oauthClients.clientId),
    userId: varchar("user_id", { length: 26 })
      .notNull()
      .references(() => users.id),
    accessTokenHash: text("access_token_hash").notNull(),
    refreshTokenHash: text("refresh_token_hash"),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accessTokenIdx: uniqueIndex("oauth_tokens_access_token_idx").on(table.accessTokenHash),
    refreshTokenIdx: uniqueIndex("oauth_tokens_refresh_token_idx").on(table.refreshTokenHash),
  }),
);

export const oauthAuthorizationCodes = pgTable(
  "oauth_authorization_codes",
  {
    id: varchar("id", { length: 26 }).primaryKey(), // ulid
    codeHash: text("code_hash").notNull(),
    clientId: varchar("client_id", { length: 64 })
      .notNull()
      .references(() => oauthClients.clientId),
    userId: varchar("user_id", { length: 26 })
      .notNull()
      .references(() => users.id),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: varchar("code_challenge_method", { length: 10 }).notNull(),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeHashIdx: uniqueIndex("oauth_authorization_codes_code_hash_idx").on(table.codeHash),
  }),
);

export const accountRegisterAttempts = pgTable(
  "account_register_attempts",
  {
    id: varchar("id", { length: 26 }).primaryKey(), // ulid
    userId: varchar("user_id", { length: 26 })
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("account_register_attempts_user_idx").on(table.userId, table.createdAt),
  }),
);
