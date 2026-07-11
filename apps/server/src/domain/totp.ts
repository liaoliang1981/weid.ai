import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// RFC 4226 HOTP.
function hotp(secret: Buffer, counter: bigint): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

// RFC 6238 TOTP.
function totpAt(secretBase32: string, timeMs: number): string {
  const counter = BigInt(Math.floor(timeMs / 1000 / STEP_SECONDS));
  return hotp(base32Decode(secretBase32), counter);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function currentTotpCode(secretBase32: string): string {
  return totpAt(secretBase32, Date.now());
}

// Accepts the current step and one step on either side to tolerate clock drift.
export function verifyTotpCode(secretBase32: string, token: string): boolean {
  const clean = token.trim();
  if (!/^\d{6}$/.test(clean)) return false;
  const now = Date.now();
  for (const drift of [0, -1, 1]) {
    if (totpAt(secretBase32, now + drift * STEP_SECONDS * 1000) === clean) return true;
  }
  return false;
}

// `account` labels the entry inside the authenticator app (shown under the
// issuer name). At identity creation there's no Weid number yet, so callers
// pass a placeholder; once a number is claimed, callers can build a fresh
// URL with "@{number}" for the user to re-scan and relabel their entry.
export function totpAuthUrl(secretBase32: string, account: string, issuer = "weid.ai"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// Secrets are encrypted at rest (AES-256-GCM) keyed off SESSION_SECRET, so a
// database leak alone doesn't hand over live authenticator codes.
function deriveEncryptionKey(sessionSecret: string): Buffer {
  return createHash("sha256").update(sessionSecret).digest();
}

export function encryptTotpSecret(sessionSecret: string, secret: string): string {
  const key = deriveEncryptionKey(sessionSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), encrypted.toString("hex"), tag.toString("hex")].join(":");
}

export function decryptTotpSecret(sessionSecret: string, stored: string): string {
  const [ivHex, dataHex, tagHex] = stored.split(":");
  if (!ivHex || !dataHex || !tagHex) {
    throw new Error("malformed encrypted TOTP secret");
  }
  const key = deriveEncryptionKey(sessionSecret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}
