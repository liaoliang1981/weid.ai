import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { accounts, users, type Db } from "@weid/db";
import { DomainError } from "./errors.js";
import { normalizeNumber } from "./numbers.js";
import { registerAccount } from "./account.js";
import { encryptTotpSecret, generateTotpSecret, totpAuthUrl, verifyTotpCode, decryptTotpSecret } from "./totp.js";

export interface NewIdentity {
  userId: string;
  number: bigint;
  secret: string;
  otpauthUrl: string;
}

// Registration only happens through the OAuth connector flow (claude.ai /
// ChatGPT redirect to auth.weid.ai), never as a bare web form — so nickname,
// number, and the TOTP secret are all minted together in one step, and the
// QR code shown to the user is labeled with the real number from the start
// (one scan, not "scan once now, scan again after you have a number").
// The number is public (meant to be shared: "add me @10024"), so it can
// never double as a login secret — a TOTP authenticator-app code is that
// secret instead. Login is number + current 6-digit code, looked up by
// number. The raw secret is shown to the user exactly once (at creation)
// and only ever stored encrypted at rest.
export async function createIdentity(db: Db, sessionSecret: string, nickname: string): Promise<NewIdentity> {
  const userId = ulid();
  const secret = generateTotpSecret();
  await db.insert(users).values({ id: userId, totpSecretEncrypted: encryptTotpSecret(sessionSecret, secret) });
  const number = await registerAccount(db, userId, nickname);
  return { userId, number, secret, otpauthUrl: totpAuthUrl(secret, `@${number}`) };
}

export async function loginWithTotp(db: Db, sessionSecret: string, numberRaw: string, code: string): Promise<string> {
  const number = normalizeNumber(numberRaw);
  if (number === null) {
    throw new DomainError(`号码格式不对: ${numberRaw} / invalid number format`);
  }

  const [account] = await db.select().from(accounts).where(eq(accounts.number, number)).limit(1);
  if (!account) {
    throw new DomainError("号码或验证码不对 / number or code is incorrect");
  }

  const [user] = await db.select().from(users).where(eq(users.id, account.userId)).limit(1);
  if (!user) {
    throw new DomainError("号码或验证码不对 / number or code is incorrect");
  }

  const secret = decryptTotpSecret(sessionSecret, user.totpSecretEncrypted);
  if (!verifyTotpCode(secret, code)) {
    throw new DomainError("号码或验证码不对 / number or code is incorrect");
  }

  return user.id;
}
