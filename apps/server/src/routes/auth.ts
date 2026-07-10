import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { type Db } from "@weid/db";
import { createSessionToken, verifySessionToken } from "../session.js";
import { registerAccount, updateProfile, getAccountByUserId, whoami } from "../domain/account.js";
import { createIdentity, recoverIdentity } from "../domain/identity.js";
import { DomainError } from "../domain/errors.js";

const SESSION_COOKIE = "session";

// Only ever set to paths we generated ourselves (see /authorize), so a plain
// prefix check is enough to stop this from becoming an open redirect.
function isSafeNext(next: unknown): next is string {
  return typeof next === "string" && next.startsWith("/authorize?");
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
        error: "还没登录，请先用 POST /auth/identity/new 注册或 POST /auth/identity/recover 用恢复码登录 / Not logged in — register via POST /auth/identity/new or log in with a recovery code via POST /auth/identity/recover",
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

  // Creates a brand new identity (no number yet) and shows the recovery code
  // exactly once — this is the only moment it's ever visible in plaintext.
  app.post("/auth/identity/new", async (req, reply) => {
    const schema = z.object({ next: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    const next = parsed.success && isSafeNext(parsed.data.next) ? parsed.data.next : null;

    const { userId, recoveryCode } = await createIdentity(db);
    setSessionCookie(reply, userId);

    const continueHref = next ?? "/auth/register";
    reply.type("text/html").send(`<!doctype html><html><head><meta charset="utf-8"><title>weid.ai — 保存恢复码</title></head>
<body>
  <h1>保存好你的恢复码</h1>
  <p>这串码是你找回账号的唯一方式，只会显示这一次，请立刻保存：</p>
  <pre style="font-size:18px;padding:12px;border:1px solid #ccc;">${escapeHtml(recoveryCode)}</pre>
  <p>号码本身可以随便告诉别人，但这串恢复码不行——谁拿到它谁就能登录你的账号。</p>
  <p><a href="${escapeHtml(continueHref)}">我已保存，继续</a></p>
</body></html>`);
  });

  // Logs back in with a previously issued recovery code.
  app.post("/auth/identity/recover", async (req, reply) => {
    const schema = z.object({ code: z.string().min(1), next: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "恢复码不能为空 / recovery code is required" });
    }

    let userId: string;
    try {
      userId = await recoverIdentity(db, parsed.data.code);
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
