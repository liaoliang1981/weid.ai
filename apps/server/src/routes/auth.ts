import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { type Db } from "@weid/db";
import { createSessionToken, verifySessionToken } from "../session.js";
import { registerAccount, updateProfile, getAccountByUserId, whoami } from "../domain/account.js";
import { createIdentity, loginWithPassword } from "../domain/identity.js";
import { DomainError } from "../domain/errors.js";

const SESSION_COOKIE = "session";

// Only ever set to paths we generated ourselves (see /authorize), so a plain
// prefix check is enough to stop this from becoming an open redirect.
function isSafeNext(next: unknown): next is string {
  return typeof next === "string" && next.startsWith("/authorize?");
}

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

export interface AuthRouteOptions {
  db: Db;
  sessionSecret: string;
}

export async function authRoutes(app: FastifyInstance, opts: AuthRouteOptions) {
  const { db, sessionSecret } = opts;

  app.addHook("preHandler", async (req: FastifyRequest, _reply: FastifyReply) => {
    const raw = req.cookies?.[SESSION_COOKIE];
    const payload = verifySessionToken(sessionSecret, raw);
    if (payload) req.userId = payload.userId;
  });

  function requireSession(req: FastifyRequest, reply: FastifyReply): string | null {
    if (!req.userId) {
      reply.code(401).send({
        error: "还没登录，请先用 POST /auth/identity/new 注册或 POST /auth/identity/login 用号码+密码登录 / Not logged in — register via POST /auth/identity/new or log in via POST /auth/identity/login",
      });
      return null;
    }
    return req.userId;
  }

  function setSessionCookie(reply: FastifyReply, userId: string) {
    const token = createSessionToken(sessionSecret, userId);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
  }

  // Standalone entry point — lets someone register or log back in directly
  // on auth.weid.ai, independent of any OAuth connector flow. Establishes a
  // session so that connecting a connector afterward skips straight to
  // consent (same as visiting github.com to sign in before authorizing an app).
  app.get("/", async (req, reply) => {
    if (req.userId) {
      const account = await getAccountByUserId(db, req.userId);
      return reply.redirect(account ? "/me" : "/auth/register");
    }

    reply.type("text/html").send(`<!doctype html><html><head><meta charset="utf-8"><title>weid.ai — 登录</title></head>
<body>
  <h1>weid.ai</h1>

  <h2>还没有 Weid 号？</h2>
  <form method="post" action="/auth/identity/new">
    <input type="password" name="password" required minlength="8" placeholder="设一个密码（至少 8 位）">
    <button type="submit">注册新号</button>
  </form>

  <h2>已经有号了？</h2>
  <form method="post" action="/auth/identity/login">
    <input type="text" name="number" required placeholder="你的 Weid 号">
    <input type="password" name="password" required placeholder="密码">
    <button type="submit">登录</button>
  </form>
</body></html>`);
  });

  // Creates a brand new identity with a user-chosen password (no number yet).
  app.post("/auth/identity/new", async (req, reply) => {
    const schema = z.object({ password: z.string().min(1), next: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "密码不能为空 / password is required" });
    }

    let userId: string;
    try {
      userId = await createIdentity(db, parsed.data.password);
    } catch (err) {
      if (err instanceof DomainError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
    setSessionCookie(reply, userId);

    if (isSafeNext(parsed.data.next)) {
      return reply.redirect(parsed.data.next);
    }
    return reply.redirect("/auth/register");
  });

  // Logs back in with the Weid number + the password chosen at registration.
  app.post("/auth/identity/login", async (req, reply) => {
    const schema = z.object({ number: z.string().min(1), password: z.string().min(1), next: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "号码和密码不能为空 / number and password are required" });
    }

    let userId: string;
    try {
      userId = await loginWithPassword(db, parsed.data.number, parsed.data.password);
    } catch (err) {
      if (err instanceof DomainError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }

    setSessionCookie(reply, userId);

    if (isSafeNext(parsed.data.next)) {
      return reply.redirect(parsed.data.next);
    }

    const account = await getAccountByUserId(db, userId);
    return reply.redirect(account ? "/me" : "/auth/register");
  });

  app.get("/auth/register", async (req, reply) => {
    const userId = requireSession(req, reply);
    if (!userId) return;

    const account = await getAccountByUserId(db, userId);
    if (account) return reply.redirect("/me");

    reply.type("text/html").send(`<!doctype html><html><head><meta charset="utf-8"><title>weid.ai — 领号</title></head>
<body>
  <h1>给自己起个昵称</h1>
  <form method="post" action="/auth/register">
    <input type="text" name="nickname" maxlength="30" required placeholder="任意语言，1-30 字符">
    <button type="submit">领取我的 Weid 号</button>
  </form>
</body></html>`);
  });

  app.post("/auth/register", async (req, reply) => {
    const userId = requireSession(req, reply);
    if (!userId) return;

    const schema = z.object({ nickname: z.string().min(1), next: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "昵称不能为空 / nickname is required" });
    }

    let number: bigint;
    try {
      number = await registerAccount(db, userId, parsed.data.nickname);
    } catch (err) {
      if (err instanceof DomainError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }

    if (isSafeNext(parsed.data.next)) {
      return reply.redirect(parsed.data.next);
    }

    return reply.send({
      ok: true,
      number: number.toString(),
      message: `你的 Weid 号是 @${number}，越早注册号越靠前，此号终身归你。/ Your Weid number is @${number} — permanently yours.`,
    });
  });

  app.get("/me", async (req, reply) => {
    const userId = requireSession(req, reply);
    if (!userId) return;

    const info = await whoami(db, userId);
    if (!info) {
      return reply.code(404).send({ error: "你还没有 Weid 号，请先用 /auth/register 注册 / no Weid number yet" });
    }
    return info;
  });

  app.post("/auth/profile", async (req, reply) => {
    const userId = requireSession(req, reply);
    if (!userId) return;

    const account = await getAccountByUserId(db, userId);
    if (!account) {
      return reply.code(404).send({ error: "你还没有 Weid 号，请先注册 / no Weid number yet" });
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

    try {
      await updateProfile(db, account.number, parsed.data);
    } catch (err) {
      if (err instanceof DomainError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }

    return { ok: true };
  });
}
