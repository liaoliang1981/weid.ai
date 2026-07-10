import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { accounts, users, type Db } from "@weid/db";
import { DomainError } from "./errors.js";
import { normalizeNumber } from "./numbers.js";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

const MIN_PASSWORD_LENGTH = 8;

// The number is public (meant to be shared: "add me @10024"), so it can
// never double as a login secret — the password is that secret instead.
// Login is number + password, looked up by number, unlike a token/code
// that's looked up by itself.
export async function createIdentity(db: Db, password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError(`密码至少 ${MIN_PASSWORD_LENGTH} 位 / password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const userId = ulid();
  await db.insert(users).values({ id: userId, passwordHash: await hashPassword(password) });
  return userId;
}

export async function loginWithPassword(db: Db, numberRaw: string, password: string): Promise<string> {
  const number = normalizeNumber(numberRaw);
  if (number === null) {
    throw new DomainError(`号码格式不对: ${numberRaw} / invalid number format`);
  }

  const [account] = await db.select().from(accounts).where(eq(accounts.number, number)).limit(1);
  if (!account) {
    throw new DomainError("号码或密码不对 / number or password is incorrect");
  }

  const [user] = await db.select().from(users).where(eq(users.id, account.userId)).limit(1);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new DomainError("号码或密码不对 / number or password is incorrect");
  }

  return user.id;
}
