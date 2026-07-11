import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import QRCode from "qrcode";
import { type Db } from "@weid/db";
import { createSessionToken, verifySessionToken } from "../session.js";
import { updateProfile, getAccountByUserId, whoami } from "../domain/account.js";
import { createIdentity, loginWithTotp } from "../domain/identity.js";
import { DomainError } from "../domain/errors.js";

const SESSION_COOKIE = "session";

// Only ever set to paths we generated ourselves (see /authorize), so a plain
// prefix check is enough to stop this from becoming an open redirect.
function isSafeNext(next: unknown): next is string {
  return typeof next === "string" && next.startsWith("/authorize?");
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Shown exactly once, right after the secret is generated — there is no
// "forgot my code" recovery, same redline as the password design it
// replaces, so the user must save this before continuing. Nickname, number,
// and secret are all minted together (see domain/identity.ts), so the QR
// already carries the real number — one scan is enough.
async function totpSecretPage(number: bigint, secret: string, otpauthUrl: string, next: string | undefined): Promise<string> {
  const continueHref = escapeHtml(next ?? "/me");
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
  return `<!doctype html><html><head><meta charset="utf-8"><title>weid.ai — Authenticator key</title></head>
<body>
  <h1>Your Weid number is @${number}</h1>
  <p>Scan this with Google Authenticator, Authy, or a similar app:</p>
  <p><img src="${qrDataUrl}" width="240" height="240" alt="Scan to add to your authenticator app"></p>
  <p>If your app can't scan, enter this key manually instead:</p>
  <p><code style="font-size:1.2em">${escapeHtml(secret)}</code></p>
  <p><strong>Save this now. Losing this key means losing access to this account — there is no recovery.</strong></p>
  <p>Once added, your app will show a rotating 6-digit code. Use that code to log in.</p>
  <a href="${continueHref}">I've saved it, continue →</a>
</body></html>`;
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
        error: "还没登录，请先用号码+验证码登录，或在 Claude/ChatGPT 里添加 https://mcp.weid.ai 连接器完成注册 / Not logged in — log in with your number + code, or add https://mcp.weid.ai as a connector in Claude/ChatGPT to register",
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

  app.get("/auth/logout", async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.redirect("/");
  });

  // Standalone entry point on auth.weid.ai — no functional form here at
  // all, by design. Both registration AND login only happen as part of the
  // OAuth connector flow (see routes/oauth.ts chooserPage): the connector
  // redirects the browser to /authorize, which is where the real chooser
  // (with the nickname/number/login fields) lives. This page is just a
  // pointer to that flow, so there's no way to use the site standalone.
  app.get("/", async (req, reply) => {
    if (req.userId) {
      const account = await getAccountByUserId(db, req.userId);
      if (account) return reply.redirect("/me");
    }

    reply.type("text/html").send(`<!doctype html><html><head><meta charset="utf-8"><title>weid.ai</title></head>
<body>
  <h1>weid.ai</h1>
  <p>This site is only used through the Claude / ChatGPT connector — there's no standalone login here.</p>
  <p>Add <code>https://mcp.weid.ai</code> as a custom connector in Claude / ChatGPT and follow the prompts to register or log in.</p>
</body></html>`);
  });

  // Creates a brand new identity, claims a Weid number, and generates a TOTP
  // secret, all in one step — only reachable through the OAuth connector
  // flow's chooser form (see routes/oauth.ts), which is where the nickname
  // field lives.
  app.post("/auth/identity/new", async (req, reply) => {
    const schema = z.object({ nickname: z.string().min(1).max(30), next: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "昵称不能为空 / nickname is required" });
    }

    let identity: Awaited<ReturnType<typeof createIdentity>>;
    try {
      identity = await createIdentity(db, sessionSecret, parsed.data.nickname);
    } catch (err) {
      if (err instanceof DomainError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
    setSessionCookie(reply, identity.userId);

    const next = isSafeNext(parsed.data.next) ? parsed.data.next : undefined;
    return reply.type("text/html").send(await totpSecretPage(identity.number, identity.secret, identity.otpauthUrl, next));
  });

  // Logs back in with the Weid number + the current authenticator-app code.
  app.post("/auth/identity/login", async (req, reply) => {
    const schema = z.object({ number: z.string().min(1), code: z.string().min(1), next: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "号码和验证码不能为空 / number and code are required" });
    }

    let userId: string;
    try {
      userId = await loginWithTotp(db, sessionSecret, parsed.data.number, parsed.data.code);
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

    return reply.redirect("/me");
  });

  app.get("/me", async (req, reply) => {
    const userId = requireSession(req, reply);
    if (!userId) return;

    const info = await whoami(db, userId);
    if (!info) {
      return reply.code(404).send({ error: "账号数据异常，请重新登录 / account data inconsistent, please log in again" });
    }
    return info;
  });

  app.post("/auth/profile", async (req, reply) => {
    const userId = requireSession(req, reply);
    if (!userId) return;

    const account = await getAccountByUserId(db, userId);
    if (!account) {
      return reply.code(404).send({ error: "账号数据异常，请重新登录 / account data inconsistent, please log in again" });
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
