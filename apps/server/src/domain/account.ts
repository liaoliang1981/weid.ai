import { eq, and, gt, sql } from "drizzle-orm";
import { accounts, agentCards, allocateNumber, accountRegisterAttempts, friendRequests, messages, users, type Db } from "@weid/db";
import { ulid } from "ulid";
import { DomainError } from "./errors.js";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "../i18n/index.js";

const REGISTER_ATTEMPTS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// 1-30 chars, any unicode incl. Chinese; strip control chars and surrounding whitespace only.
export function sanitizeNickname(input: string): string {
  return input.replace(/\p{Cc}/gu, "").trim();
}

export async function registerAccount(db: Db, userId: string, rawNickname: string): Promise<bigint> {
  const [existing] = await db.select().from(accounts).where(eq(accounts.userId, userId)).limit(1);
  if (existing) {
    throw new DomainError((e) => e.alreadyHaveNumber);
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accountRegisterAttempts)
    .where(
      and(
        eq(accountRegisterAttempts.userId, userId),
        gt(accountRegisterAttempts.createdAt, new Date(Date.now() - DAY_MS)),
      ),
    );
  if (count >= REGISTER_ATTEMPTS_PER_DAY) {
    throw new DomainError((e) => e.tooManyRegistrationAttempts);
  }
  await db.insert(accountRegisterAttempts).values({ id: ulid(), userId });

  const nickname = sanitizeNickname(rawNickname).slice(0, 30);
  if (!nickname) {
    throw new DomainError((e) => e.nicknameRequired);
  }

  const number = await allocateNumber(db);
  await db.insert(accounts).values({ number, userId, nickname });
  await db.insert(agentCards).values({ number });
  return number;
}

export interface ProfileUpdateInput {
  nickname?: string;
  description?: string;
  capabilities?: string[];
  orgName?: string;
  orgUrl?: string;
  languages?: string[];
  visibility?: "public" | "unlisted";
}

export async function updateProfile(db: Db, number: bigint, input: ProfileUpdateInput): Promise<void> {
  if (input.nickname !== undefined) {
    const nickname = sanitizeNickname(input.nickname).slice(0, 30);
    if (!nickname) {
      throw new DomainError((e) => e.nicknameRequired);
    }
    await db.update(accounts).set({ nickname }).where(eq(accounts.number, number));
  }

  const cardUpdate: Record<string, unknown> = {};
  if (input.description !== undefined) cardUpdate.description = input.description;
  if (input.capabilities !== undefined) cardUpdate.capabilities = input.capabilities;
  if (input.orgName !== undefined) cardUpdate.orgName = input.orgName;
  if (input.orgUrl !== undefined) cardUpdate.orgUrl = input.orgUrl;
  if (input.languages !== undefined) cardUpdate.languages = input.languages;
  if (input.visibility !== undefined) cardUpdate.visibility = input.visibility;

  if (Object.keys(cardUpdate).length > 0) {
    cardUpdate.updatedAt = new Date();
    await db.update(agentCards).set(cardUpdate).where(eq(agentCards.number, number));
  }
}

export async function getAccountByUserId(db: Db, userId: string) {
  const [account] = await db.select().from(accounts).where(eq(accounts.userId, userId)).limit(1);
  return account ?? null;
}

export async function requireAccount(db: Db, userId: string) {
  const account = await getAccountByUserId(db, userId);
  if (!account) {
    throw new DomainError((e) => e.accountDataInconsistent);
  }
  return account;
}

export async function requireAccountNumber(db: Db, userId: string): Promise<bigint> {
  const account = await requireAccount(db, userId);
  return account.number;
}

// The user's locale is fixed at registration (from their browser's
// Accept-Language header — see routes/auth.ts) and reused for every MCP
// tool call after that, since the MCP transport itself carries no reliable
// per-request language signal for the human on the other end.
export async function getUserLocale(db: Db, userId: string): Promise<Locale> {
  const [user] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
  const locale = user?.locale as Locale | undefined;
  return locale && (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? locale : DEFAULT_LOCALE;
}

export interface WhoAmI {
  number: string;
  nickname: string;
  status: string;
  tier: string;
  unreadCount: number;
  pendingFriendRequestCount: number;
}

export async function whoami(db: Db, userId: string): Promise<WhoAmI | null> {
  const account = await getAccountByUserId(db, userId);
  if (!account) return null;

  const [{ count: unreadCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.toNumber, account.number), eq(messages.status, "unread")));

  const [{ count: pendingFriendRequestCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(friendRequests)
    .where(and(eq(friendRequests.toNumber, account.number), eq(friendRequests.status, "pending")));

  return {
    number: account.number.toString(),
    nickname: account.nickname,
    status: account.status,
    tier: account.tier,
    unreadCount,
    pendingFriendRequestCount,
  };
}
