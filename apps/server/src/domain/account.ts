import { eq, and, gt, sql } from "drizzle-orm";
import { accounts, agentCards, allocateNumber, accountRegisterAttempts, friendRequests, messages, type Db } from "@weid/db";
import { ulid } from "ulid";
import { DomainError } from "./errors.js";

const REGISTER_ATTEMPTS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// 1-30 chars, any unicode incl. Chinese; strip control chars and surrounding whitespace only.
export function sanitizeNickname(input: string): string {
  return input.replace(/\p{Cc}/gu, "").trim();
}

export async function registerAccount(db: Db, userId: string, rawNickname: string): Promise<bigint> {
  const [existing] = await db.select().from(accounts).where(eq(accounts.userId, userId)).limit(1);
  if (existing) {
    throw new DomainError("你已经有一个 Weid 号了 / you already have a Weid number");
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
    throw new DomainError("今天注册尝试次数太多了，请明天再试 / too many registration attempts today, try again tomorrow");
  }
  await db.insert(accountRegisterAttempts).values({ id: ulid(), userId });

  const nickname = sanitizeNickname(rawNickname).slice(0, 30);
  if (!nickname) {
    throw new DomainError("昵称不能为空 / nickname is required");
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
      throw new DomainError("昵称不能为空 / nickname is required");
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
    throw new DomainError("你还没有 Weid 号，请先用 register_account 注册 / you don't have a Weid number yet — register first with register_account");
  }
  return account;
}

export async function requireAccountNumber(db: Db, userId: string): Promise<bigint> {
  const account = await requireAccount(db, userId);
  return account.number;
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
