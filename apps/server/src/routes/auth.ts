import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import QRCode from "qrcode";
import { type Db } from "@weid/db";
import { createSessionToken, verifySessionToken } from "../session.js";
import { updateProfile, getAccountByUserId, whoami } from "../domain/account.js";
import { createIdentity, loginWithTotp } from "../domain/identity.js";
import { formatNumber } from "../domain/numbers.js";
import { DomainError } from "../domain/errors.js";
import { pickLocale, t } from "../i18n/index.js";

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
async function totpSecretPage(
  msg: ReturnType<typeof t>,
  number: bigint,
  secret: string,
  otpauthUrl: string,
  next: string | undefined,
): Promise<string> {
  const p = msg.pages.secretPage;
  const continueHref = escapeHtml(next ?? "/me");
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${p.title}</title></head>
<body>
  <h1>${escapeHtml(p.heading(formatNumber(number)))}</h1>
  <p>${p.scanInstructions}</p>
  <p><img src="${qrDataUrl}" width="240" height="240" alt="${p.scanInstructions}"></p>
  <p>${p.manualFallback}</p>
  <p><code style="font-size:1.2em">${escapeHtml(secret)}</code></p>
  <p><strong>${p.saveWarning}</strong></p>
  <p>${p.afterAdded}</p>
  <a href="${continueHref}">${p.continueLink}</a>
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
      const msg = t(pickLocale(req.headers["accept-language"]));
      reply.code(401).send({ error: msg.pages.sessionRequired });
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

  // Optional ?next= lets a caller (see routes/oauth.ts consentPage's
  // "switch account" link) drop the user straight back into the /authorize
  // flow they came from after clearing the session, instead of just the
  // generic homepage.
  app.get("/auth/logout", async (req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    const next = (req.query as Record<string, string | undefined>)?.next;
    return reply.redirect(isSafeNext(next) ? next : "/");
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

    const msg = t(pickLocale(req.headers["accept-language"]));
    const p = msg.pages.authRoot;
    reply.type("text/html").send(`<!doctype html><html><head><meta charset="utf-8"><title>${p.title}</title></head>
<body>
  <h1>${p.heading}</h1>
  <h2>${p.noNumberHeading}</h2>
  <p>${p.noNumberBody}</p>
  <h2>${p.haveNumberHeading}</h2>
  <form method="post" action="/auth/identity/login">
    <input type="text" name="number" required placeholder="${escapeHtml(p.numberPlaceholder)}">
    <input type="text" name="code" required inputmode="numeric" pattern="[0-9]{6}" placeholder="${escapeHtml(p.codePlaceholder)}">
    <button type="submit">${p.loginButton}</button>
  </form>
</body></html>`);
  });

  // Creates a brand new identity, claims a Weid number, and generates a TOTP
  // secret, all in one step — only reachable through the OAuth connector
  // flow's chooser form (see routes/oauth.ts), which is where the nickname
  // field lives. Locale is detected here (real Accept-Language header on
  // this registration request) and stuck to the identity for every future
  // MCP tool call — see domain/identity.ts.
  app.post("/auth/identity/new", async (req, reply) => {
    const locale = pickLocale(req.headers["accept-language"]);
    const msg = t(locale);
    const schema = z.object({ nickname: z.string().min(1).max(30), next: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: msg.errors.nicknameRequired });
    }

    let identity: Awaited<ReturnType<typeof createIdentity>>;
    try {
      identity = await createIdentity(db, sessionSecret, parsed.data.nickname, locale);
    } catch (err) {
      if (err instanceof DomainError) {
        return reply.code(400).send({ error: err.render(msg.errors) });
      }
      throw err;
    }
    setSessionCookie(reply, identity.userId);

    const next = isSafeNext(parsed.data.next) ? parsed.data.next : undefined;
    return reply.type("text/html").send(await totpSecretPage(msg, identity.number, identity.secret, identity.otpauthUrl, next));
  });

  // Logs back in with the Weid number + the current authenticator-app code.
  app.post("/auth/identity/login", async (req, reply) => {
    const msg = t(pickLocale(req.headers["accept-language"]));
    const schema = z.object({ number: z.string().min(1), code: z.string().min(1), next: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: msg.errors.loginIncorrect });
    }

    let userId: string;
    try {
      userId = await loginWithTotp(db, sessionSecret, parsed.data.number, parsed.data.code);
    } catch (err) {
      if (err instanceof DomainError) {
        return reply.code(400).send({ error: err.render(msg.errors) });
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
      const msg = t(pickLocale(req.headers["accept-language"]));
      return reply.code(404).send({ error: msg.pages.accountDataInconsistentShort });
    }
    return info;
  });

  app.post("/auth/profile", async (req, reply) => {
    const userId = requireSession(req, reply);
    if (!userId) return;

    const msg = t(pickLocale(req.headers["accept-language"]));

    const account = await getAccountByUserId(db, userId);
    if (!account) {
      return reply.code(404).send({ error: msg.pages.accountDataInconsistentShort });
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
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    try {
      await updateProfile(db, account.number, parsed.data);
    } catch (err) {
      if (err instanceof DomainError) {
        return reply.code(400).send({ error: err.render(msg.errors) });
      }
      throw err;
    }

    return { ok: true };
  });
}
