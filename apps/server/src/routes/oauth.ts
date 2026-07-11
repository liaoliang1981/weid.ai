import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { eq, and, isNull, gt } from "drizzle-orm";
import { oauthClients, oauthAuthorizationCodes, oauthTokens, type Db } from "@weid/db";
import { getAccountByUserId } from "../domain/account.js";
import { verifySessionToken } from "../session.js";

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function base64urlSha256(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

const AuthorizeQuery = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(1),
  code_challenge_method: z.literal("S256"),
  state: z.string().optional(),
  scope: z.string().optional(),
});

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hiddenFields(query: Record<string, string | undefined>): string {
  return Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v!)}">`)
    .join("\n    ");
}

function chooserPage(next: string): string {
  const nextField = `<input type="hidden" name="next" value="${escapeHtml(next)}">`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>weid.ai — Log in</title></head>
<body>
  <h1>Log in to weid.ai to authorize</h1>

  <h2>Don't have a Weid number yet?</h2>
  <form method="post" action="/auth/identity/new">
    <input type="text" name="nickname" required maxlength="30" placeholder="Pick a nickname, any language">
    ${nextField}
    <button type="submit">Generate authenticator key, register</button>
  </form>

  <h2>Already have a number?</h2>
  <form method="post" action="/auth/identity/login">
    <input type="text" name="number" required placeholder="Your Weid number">
    <input type="text" name="code" required inputmode="numeric" pattern="[0-9]{6}" placeholder="6-digit code from your authenticator app">
    ${nextField}
    <button type="submit">Log in</button>
  </form>
</body></html>`;
}

function consentPage(
  clientName: string,
  account: { number: bigint; nickname: string },
  query: z.infer<typeof AuthorizeQuery>,
  authorizeUrl: string,
): string {
  const identityLine = `<strong>${escapeHtml(clientName)}</strong> wants to access your Weid account (@${account.number} ${escapeHtml(account.nickname)}).`;
  // The browser's auth.weid.ai session is reused across every connector you
  // authorize from it (standard SSO behavior) — if you're trying to give
  // THIS connector a separate, brand-new Weid identity rather than your
  // existing one, this link logs the current session out and drops you
  // back into this same /authorize flow, which will then show the
  // register/login chooser instead of skipping straight to consent.
  const switchAccountHref = `/auth/logout?next=${encodeURIComponent(authorizeUrl)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>weid.ai — Authorize</title></head>
<body>
  <h1>Authorization request</h1>
  <p>${identityLine}</p>
  <form method="post" action="/authorize/approve">
    ${hiddenFields(query)}
    <button type="submit" name="action" value="approve">Approve</button>
    <button type="submit" name="action" value="deny">Deny</button>
  </form>
  <p><a href="${escapeHtml(switchAccountHref)}">Not this account? Log out and use a different Weid number</a></p>
</body></html>`;
}

export interface OAuthRouteOptions {
  db: Db;
  sessionSecret: string;
  issuer: string;
  mcpUrl: string;
}

export async function oauthRoutes(app: FastifyInstance, opts: OAuthRouteOptions) {
  const { db, sessionSecret, issuer, mcpUrl } = opts;

  app.get("/.well-known/oauth-authorization-server", async () => ({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["weid"],
  }));

  // RFC 9728 — some MCP clients (e.g. ChatGPT's connector implementation)
  // discover the authorization server via the resource server's metadata
  // document rather than assuming it lives at the MCP server's own origin.
  app.get("/.well-known/oauth-protected-resource", async () => ({
    resource: mcpUrl,
    authorization_servers: [issuer],
  }));

  app.post("/register", async (req, reply) => {
    const schema = z.object({
      client_name: z.string().min(1),
      redirect_uris: z.array(z.string().url()).min(1),
      grant_types: z.array(z.string()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_client_metadata", error_description: "client_name and redirect_uris are required" });
    }

    const clientId = ulid();
    const grantTypes = parsed.data.grant_types ?? ["authorization_code", "refresh_token"];
    await db.insert(oauthClients).values({
      clientId,
      clientName: parsed.data.client_name,
      redirectUris: parsed.data.redirect_uris,
      grantTypes,
    });

    return reply.code(201).send({
      client_id: clientId,
      client_name: parsed.data.client_name,
      redirect_uris: parsed.data.redirect_uris,
      grant_types: grantTypes,
      token_endpoint_auth_method: "none",
    });
  });

  app.get("/authorize", async (req, reply) => {
    const parsed = AuthorizeQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", error_description: parsed.error.message });
    }
    const { client_id, redirect_uri } = parsed.data;

    const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, client_id)).limit(1);
    if (!client || !client.redirectUris.includes(redirect_uri)) {
      return reply.code(400).send({ error: "invalid_client", error_description: "unknown client_id or redirect_uri" });
    }

    const session = verifySessionToken(sessionSecret, req.cookies?.session);
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    const next = `/authorize?${queryString}`;

    if (!session) {
      return reply.type("text/html").send(chooserPage(next));
    }

    const account = await getAccountByUserId(db, session.userId);
    if (!account) {
      // Every identity now claims a number atomically at creation (see
      // domain/identity.ts) — this should be unreachable for new logins.
      // Only a leftover session from before that change could land here.
      return reply.code(409).send({ error: "账号数据异常，请到 /auth/logout 清除登录状态后重试 / account data inconsistent, log out and try again" });
    }
    return reply.type("text/html").send(consentPage(client.clientName, account, parsed.data, next));
  });

  app.post("/authorize/approve", async (req, reply) => {
    const bodySchema = AuthorizeQuery.extend({ action: z.enum(["approve", "deny"]) });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", error_description: parsed.error.message });
    }
    const { client_id, redirect_uri, code_challenge, state, scope, action } = parsed.data;

    const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, client_id)).limit(1);
    if (!client || !client.redirectUris.includes(redirect_uri)) {
      return reply.code(400).send({ error: "invalid_client", error_description: "unknown client_id or redirect_uri" });
    }

    const session = verifySessionToken(sessionSecret, req.cookies?.session);
    if (!session) {
      return reply.code(401).send({ error: "login_required" });
    }

    const url = new URL(redirect_uri);
    if (action === "deny") {
      url.searchParams.set("error", "access_denied");
      if (state) url.searchParams.set("state", state);
      return reply.redirect(url.toString());
    }

    const code = randomBytes(32).toString("base64url");
    await db.insert(oauthAuthorizationCodes).values({
      id: ulid(),
      codeHash: sha256hex(code),
      clientId: client_id,
      userId: session.userId,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: "S256",
      scope,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    });

    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    return reply.redirect(url.toString());
  });

  app.post("/token", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const grantType = body.grant_type;

    if (grantType === "authorization_code") {
      const schema = z.object({
        grant_type: z.literal("authorization_code"),
        code: z.string().min(1),
        redirect_uri: z.string().url(),
        client_id: z.string().min(1),
        code_verifier: z.string().min(1),
      });
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", error_description: parsed.error.message });
      }

      const codeHash = sha256hex(parsed.data.code);
      const [row] = await db
        .select()
        .from(oauthAuthorizationCodes)
        .where(
          and(
            eq(oauthAuthorizationCodes.codeHash, codeHash),
            isNull(oauthAuthorizationCodes.usedAt),
            gt(oauthAuthorizationCodes.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (
        !row ||
        row.clientId !== parsed.data.client_id ||
        row.redirectUri !== parsed.data.redirect_uri
      ) {
        return reply.code(400).send({ error: "invalid_grant", error_description: "code invalid, expired, or mismatched" });
      }

      const expectedChallenge = base64urlSha256(parsed.data.code_verifier);
      if (!timingSafeEqualStr(expectedChallenge, row.codeChallenge)) {
        return reply.code(400).send({ error: "invalid_grant", error_description: "PKCE verification failed" });
      }

      await db
        .update(oauthAuthorizationCodes)
        .set({ usedAt: new Date() })
        .where(eq(oauthAuthorizationCodes.id, row.id));

      return reply.send(await issueTokens(db, row.clientId, row.userId, row.scope));
    }

    if (grantType === "refresh_token") {
      const schema = z.object({
        grant_type: z.literal("refresh_token"),
        refresh_token: z.string().min(1),
        client_id: z.string().min(1),
      });
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", error_description: parsed.error.message });
      }

      const refreshHash = sha256hex(parsed.data.refresh_token);
      const [row] = await db
        .select()
        .from(oauthTokens)
        .where(and(eq(oauthTokens.refreshTokenHash, refreshHash), isNull(oauthTokens.revokedAt)))
        .limit(1);

      const refreshExpired = row && Date.now() - row.createdAt.getTime() > REFRESH_TOKEN_TTL_MS;
      if (!row || row.clientId !== parsed.data.client_id || refreshExpired) {
        return reply.code(400).send({ error: "invalid_grant", error_description: "refresh token invalid, expired, or revoked" });
      }

      await db.update(oauthTokens).set({ revokedAt: new Date() }).where(eq(oauthTokens.id, row.id));
      return reply.send(await issueTokens(db, row.clientId, row.userId, row.scope));
    }

    return reply.code(400).send({ error: "unsupported_grant_type" });
  });
}

export interface VerifiedToken {
  userId: string;
  clientId: string;
  scope: string | null;
}

export async function verifyAccessToken(db: Db, token: string): Promise<VerifiedToken | null> {
  const accessTokenHash = sha256hex(token);
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(
      and(eq(oauthTokens.accessTokenHash, accessTokenHash), isNull(oauthTokens.revokedAt), gt(oauthTokens.expiresAt, new Date())),
    )
    .limit(1);
  if (!row) return null;
  return { userId: row.userId, clientId: row.clientId, scope: row.scope };
}

async function issueTokens(db: Db, clientId: string, userId: string, scope: string | null) {
  const accessToken = randomBytes(32).toString("base64url");
  const refreshToken = randomBytes(32).toString("base64url");

  await db.insert(oauthTokens).values({
    id: ulid(),
    clientId,
    userId,
    accessTokenHash: sha256hex(accessToken),
    refreshTokenHash: sha256hex(refreshToken),
    scope,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
  });

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_MS / 1000,
    refresh_token: refreshToken,
    scope: scope ?? undefined,
  };
}
