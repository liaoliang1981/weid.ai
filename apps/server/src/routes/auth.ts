import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ulid } from "ulid";
import { z } from "zod";
import { accounts, agentCards, allocateNumber, loginTokens, users, type Db } from "@2088/db";
import { eq, and, isNull, gt } from "drizzle-orm";
import { sendMagicLink } from "../email.js";
import { createSessionToken, verifySessionToken } from "../session.js";

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_COOKIE = "session";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// 1-30 chars, any unicode incl. Chinese; strip control chars and surrounding whitespace.
function sanitizeNickname(input: string): string {
  return input.replace(/\p{Cc}/gu, "").trim();
}

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

export interface AuthRouteOptions {
  db: Db;
  sessionSecret: string;
  authBaseUrl: string;
  devMode: boolean;
}

export async function authRoutes(app: FastifyInstance, opts: AuthRouteOptions) {
  const { db, sessionSecret, authBaseUrl, devMode } = opts;

  app.addHook("preHandler", async (req: FastifyRequest, _reply: FastifyReply) => {
    const raw = req.cookies?.[SESSION_COOKIE];
    const payload = verifySessionToken(sessionSecret, raw);
    if (payload) req.userId = payload.userId;
  });

  function requireSession(req: FastifyRequest, reply: FastifyReply): string | null {
    if (!req.userId) {
      reply.code(401).send({
        error: "还没登录，请先用 POST /auth/request-link 请求登录链接 / Not logged in — request a magic link via POST /auth/request-link first",
      });
      return null;
    }
    return req.userId;
  }

  app.post("/auth/request-link", async (req, reply) => {
    const schema = z.object({ email: z.string().email() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "邮箱格式不对 / invalid email" });
    }
    const email = parsed.data.email.trim().toLowerCase();

    const raw = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(raw);
    await db.insert(loginTokens).values({
      id: ulid(),
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
    });

    const verifyUrl = `${authBaseUrl}/auth/verify?token=${raw}`;
    await sendMagicLink(email, verifyUrl);

    return { ok: true, ...(devMode ? { devLoginUrl: verifyUrl } : {}) };
  });

  app.get("/auth/verify", async (req, reply) => {
    const schema = z.object({ token: z.string().min(1) });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "缺少 token / missing token" });
    }
    const tokenHash = hashToken(parsed.data.token);

    const [row] = await db
      .select()
      .from(loginTokens)
      .where(
        and(
          eq(loginTokens.tokenHash, tokenHash),
          isNull(loginTokens.usedAt),
          gt(loginTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!row) {
      return reply.code(400).send({ error: "登录链接无效或已过期 / link invalid or expired" });
    }

    await db.update(loginTokens).set({ usedAt: new Date() }).where(eq(loginTokens.id, row.id));

    let [user] = await db.select().from(users).where(eq(users.email, row.email)).limit(1);
    if (!user) {
      [user] = await db
        .insert(users)
        .values({ id: ulid(), email: row.email })
        .returning();
    }

    const token = createSessionToken(sessionSecret, user.id);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });

    const [account] = await db.select().from(accounts).where(eq(accounts.userId, user.id)).limit(1);
    if (account) {
      return reply.redirect("/me");
    }
    return reply.redirect("/auth/register");
  });

  app.get("/auth/register", async (req, reply) => {
    const userId = requireSession(req, reply);
    if (!userId) return;

    const [account] = await db.select().from(accounts).where(eq(accounts.userId, userId)).limit(1);
    if (account) return reply.redirect("/me");

    reply.type("text/html").send(`<!doctype html><html><head><meta charset="utf-8"><title>2088.ai — 领号</title></head>
<body>
  <h1>给自己起个昵称</h1>
  <form method="post" action="/auth/register">
    <input type="text" name="nickname" maxlength="30" required placeholder="任意语言，1-30 字符">
    <button type="submit">领取我的 2088 号</button>
  </form>
</body></html>`);
  });

  app.post("/auth/register", async (req, reply) => {
    const userId = requireSession(req, reply);
    if (!userId) return;

    const [existing] = await db.select().from(accounts).where(eq(accounts.userId, userId)).limit(1);
    if (existing) {
      return reply.code(409).send({ error: "你已经有一个 2088 号了 / you already have a 2088 number" });
    }

    const schema = z.object({ nickname: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "昵称不能为空 / nickname is required" });
    }
    const nickname = sanitizeNickname(parsed.data.nickname).slice(0, 30);
    if (!nickname) {
      return reply.code(400).send({ error: "昵称不能为空 / nickname is required" });
    }

    const number = await allocateNumber(db);
    await db.insert(accounts).values({ number, userId, nickname });
    await db.insert(agentCards).values({ number });

    return reply.send({
      ok: true,
      number: number.toString(),
      message: `你的 2088 号是 @${number}，越早注册号越靠前，此号终身归你。/ Your 2088 number is @${number} — permanently yours.`,
    });
  });

  app.get("/me", async (req, reply) => {
    const userId = requireSession(req, reply);
    if (!userId) return;

    const [account] = await db.select().from(accounts).where(eq(accounts.userId, userId)).limit(1);
    if (!account) {
      return reply.code(404).send({ error: "你还没有 2088 号，请先用 /auth/register 注册 / no 2088 number yet" });
    }
    return {
      number: account.number.toString(),
      nickname: account.nickname,
      status: account.status,
      tier: account.tier,
    };
  });

  app.post("/auth/profile", async (req, reply) => {
    const userId = requireSession(req, reply);
    if (!userId) return;

    const [account] = await db.select().from(accounts).where(eq(accounts.userId, userId)).limit(1);
    if (!account) {
      return reply.code(404).send({ error: "你还没有 2088 号，请先注册 / no 2088 number yet" });
    }

    const schema = z.object({
      nickname: z.string().min(1).max(30).optional(),
      description: z.string().max(2000).optional(),
      capabilities: z.array(z.string().max(50)).max(20).optional(),
      orgName: z.string().max(200).optional(),
      orgUrl: z.string().url().optional(),
      languages: z.array(z.string().max(10)).max(10).optional(),
      visibility: z.enum(["public", "unlisted"]).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "参数不对 / invalid input", details: parsed.error.flatten() });
    }
    const input = parsed.data;

    if (input.nickname !== undefined) {
      const nickname = sanitizeNickname(input.nickname).slice(0, 30);
      if (!nickname) {
        return reply.code(400).send({ error: "昵称不能为空 / nickname is required" });
      }
      await db.update(accounts).set({ nickname }).where(eq(accounts.number, account.number));
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
      await db.update(agentCards).set(cardUpdate).where(eq(agentCards.number, account.number));
    }

    return { ok: true };
  });
}
