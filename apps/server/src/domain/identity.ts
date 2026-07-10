import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { users, type Db } from "@weid/db";
import { DomainError } from "./errors.js";

function hashCode(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Recovery codes are the only credential in this system — no email, no
// password. The number is meant to be shared publicly, so it can never
// double as a login secret; this code is that secret instead.
export async function createIdentity(db: Db): Promise<{ userId: string; recoveryCode: string }> {
  const recoveryCode = randomBytes(20).toString("base64url");
  const userId = ulid();
  await db.insert(users).values({ id: userId, recoveryCodeHash: hashCode(recoveryCode) });
  return { userId, recoveryCode };
}

export async function recoverIdentity(db: Db, code: string): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.recoveryCodeHash, hashCode(code))).limit(1);
  if (!user) {
    throw new DomainError("恢复码不对，请检查后重试 / recovery code is invalid, please check and try again");
  }
  return user.id;
}
