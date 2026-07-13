import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { accounts, users, type Db } from "@weid/db";
import { DomainError } from "./errors.js";
import { normalizeNumber, formatNumber } from "./numbers.js";
import { registerAccount } from "./account.js";
import { encryptTotpSecret, generateTotpSecret, totpAuthUrl, verifyTotpCode, decryptTotpSecret } from "./totp.js";
import type { Locale } from "../i18n/index.js";

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
// The number is public (meant to be shared: "add me WEID-10024"), so it can
// never double as a login secret — a TOTP authenticator-app code is that
// secret instead. Login is number + current 6-digit code, looked up by
// number. The raw secret is shown to the user exactly once (at creation)
// and only ever stored encrypted at rest. `locale` is detected once here
// (from the registration request's Accept-Language header) and stuck to
// this identity for every future MCP tool call, since the MCP transport
// itself doesn't carry a reliable per-request language signal.
export async function createIdentity(db: Db, sessionSecret: string, nickname: string, locale: Locale): Promise<NewIdentity> {
  const userId = ulid();
  const secret = generateTotpSecret();
  await db.insert(users).values({ id: userId, totpSecretEncrypted: encryptTotpSecret(sessionSecret, secret), locale });
  const number = await registerAccount(db, userId, nickname);
  return { userId, number, secret, otpauthUrl: totpAuthUrl(secret, formatNumber(number)) };
}

// Decrypts the caller's own already-created TOTP secret, so the setup page
// can re-derive the QR code on a failed verification attempt without ever
// storing or re-transmitting the raw secret through the client.
export async function getDecryptedTotpSecret(db: Db, sessionSecret: string, userId: string): Promise<string | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  return decryptTotpSecret(sessionSecret, user.totpSecretEncrypted);
}

export async function loginWithTotp(db: Db, sessionSecret: string, numberRaw: string, code: string): Promise<string> {
  const number = normalizeNumber(numberRaw);
  if (number === null) {
    throw new DomainError((e) => e.invalidNumberFormat(numberRaw));
  }

  const [account] = await db.select().from(accounts).where(eq(accounts.number, number)).limit(1);
  if (!account) {
    throw new DomainError((e) => e.loginIncorrect);
  }

  const [user] = await db.select().from(users).where(eq(users.id, account.userId)).limit(1);
  if (!user) {
    throw new DomainError((e) => e.loginIncorrect);
  }

  const secret = decryptTotpSecret(sessionSecret, user.totpSecretEncrypted);
  if (!verifyTotpCode(secret, code)) {
    throw new DomainError((e) => e.loginIncorrect);
  }

  return user.id;
}
