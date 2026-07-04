import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionPayload {
  userId: string;
  exp: number;
}

function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSessionToken(secret: string, userId: string): string {
  const payload: SessionPayload = { userId, exp: Date.now() + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = sign(secret, body);
  return `${body}.${sig}`;
}

export function verifySessionToken(secret: string, token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = sign(secret, body);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.userId !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
