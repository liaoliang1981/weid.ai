import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { createDb, accounts, agentCards } from "@weid/db";
import { eq, and } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveLocale, t, SUPPORTED_LOCALES, LOCALE_LABELS, LOCALE_COOKIE, LOCALE_QUERY_PARAM, type Locale } from "./i18n.js";

const app = Fastify({ logger: true });

const databaseUrl = process.env.DATABASE_URL ?? "postgres://weid:weid@localhost:5432/weid";
const db = createDb(databaseUrl);

await app.register(cookie);

// Resolves the locale for this request (query param > cookie > browser
// Accept-Language > English) and, if the request carries an explicit
// ?lang=, persists it to a cookie so the choice sticks across the site
// without needing to keep passing ?lang= on every link.
function resolveRequestLocale(req: FastifyRequest, reply: FastifyReply): Locale {
  const queryLang = (req.query as Record<string, string | undefined>)?.[LOCALE_QUERY_PARAM];
  const cookieLang = req.cookies?.[LOCALE_COOKIE];
  const locale = resolveLocale({ queryLang, cookieLang, acceptLanguageHeader: req.headers["accept-language"] });
  if (queryLang && queryLang === locale && queryLang !== cookieLang) {
    reply.setCookie(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 24 * 60 * 60, sameSite: "lax" });
  }
  return locale;
}

// Shared visual language for every page on this site — dark, a single blue
// accent, no external fonts/CSS/JS (self-contained, no network requests
// beyond the page itself). No frontend framework per CLAUDE.md §7: this is
// plain server-rendered HTML with embedded CSS.
const styles = `
  :root {
    --bg: #0a0e1a;
    --bg-card: #11172a;
    --border: #232b45;
    --text: #e6e9f5;
    --text-dim: #8b93b0;
    --accent: #63b3ed;
    --accent-dim: #3d5a80;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
  }
  .wrap {
    max-width: 720px;
    margin: 0 auto;
    padding: 1.5rem 1.5rem 5rem;
  }
  .lang-switcher {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.4rem 0.6rem;
    margin: 0 0 3rem;
  }
  .lang-switcher a {
    font-size: 0.82rem;
    color: var(--text-dim);
    text-decoration: none;
    padding: 0.15rem 0.1rem;
    border-bottom: 2px solid transparent;
  }
  .lang-switcher a:hover {
    color: var(--text);
  }
  .lang-switcher a.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .hero-graphic {
    display: block;
    margin: 0 auto 2rem;
    width: 140px;
    height: 140px;
  }
  h1 {
    font-size: 2.25rem;
    font-weight: 700;
    text-align: center;
    margin: 0 0 1.25rem;
    letter-spacing: -0.02em;
  }
  .vision {
    font-size: 1.35rem;
    font-weight: 600;
    text-align: center;
    color: var(--text);
    margin: 0 0 1.75rem;
    letter-spacing: -0.01em;
  }
  .intro {
    font-size: 1.05rem;
    color: var(--text-dim);
    text-align: center;
    max-width: 560px;
    margin: 0 auto;
  }
  .intro a, a { color: var(--accent); text-decoration: none; }
  .intro a:hover, a:hover { text-decoration: underline; }
  code {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.15em 0.5em;
    font-size: 0.95em;
    color: var(--accent);
  }
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.5rem;
    margin: 2rem 0;
  }
  h2 {
    font-size: 1.1rem;
    color: var(--text-dim);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 0.5rem;
  }
  .usage {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
    margin-top: 2.5rem;
  }
  @media (max-width: 560px) {
    .usage { grid-template-columns: 1fr; }
  }
  .usage h2 { margin-bottom: 0.75rem; }
  .usage ol {
    margin: 0;
    padding-left: 1.25rem;
    color: var(--text-dim);
    font-size: 0.95rem;
  }
  .usage li { margin-bottom: 0.5rem; }
  .usage li:last-child { margin-bottom: 0; }
`;

// A 3D pyramid wireframe — the visible front face (apex + two base
// corners) drawn solid, and the edges running back to the hidden rear
// vertex (the hub) drawn dashed, the standard convention for showing depth
// in a 2D line drawing — as the one visual anchor on the page.
const heroGraphic = `<svg class="hero-graphic" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">
  <line x1="70" y1="25" x2="30" y2="95" stroke="#3d5a80" stroke-width="4"/>
  <line x1="70" y1="25" x2="110" y2="95" stroke="#3d5a80" stroke-width="4"/>
  <line x1="30" y1="95" x2="110" y2="95" stroke="#3d5a80" stroke-width="4"/>
  <line x1="70" y1="25" x2="70" y2="115" stroke="#3d5a80" stroke-width="3" stroke-dasharray="4 4"/>
  <line x1="30" y1="95" x2="70" y2="115" stroke="#3d5a80" stroke-width="3" stroke-dasharray="4 4"/>
  <line x1="110" y1="95" x2="70" y2="115" stroke="#3d5a80" stroke-width="3" stroke-dasharray="4 4"/>
  <circle cx="70" cy="25" r="9" fill="#e6e9f5"/>
  <circle cx="30" cy="95" r="9" fill="#e6e9f5"/>
  <circle cx="110" cy="95" r="9" fill="#e6e9f5"/>
  <circle cx="70" cy="115" r="12" fill="#63b3ed"/>
</svg>`;

// Plain links to ?lang=xx, not a <select>/JS toggle — works with zero
// JavaScript, matching the rest of this site. `path` is the current
// request's path (without query) so switching language doesn't lose which
// page you're on (e.g. a profile page).
function langSwitcher(path: string, current: Locale): string {
  const items = SUPPORTED_LOCALES.map((loc) => {
    const cls = loc === current ? ' class="active"' : "";
    return `<a href="${path}?${LOCALE_QUERY_PARAM}=${loc}"${cls}>${LOCALE_LABELS[loc]}</a>`;
  });
  return `<nav class="lang-switcher">${items.join("")}</nav>`;
}

function pageShell(title: string, path: string, locale: Locale, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${styles}</style></head>
<body><div class="wrap">${langSwitcher(path, locale)}${body}</div></body></html>`;
}

app.get("/healthz", async () => {
  return { status: "ok" };
});

app.get("/", async (req, reply) => {
  const locale = resolveRequestLocale(req, reply);
  const p = t(locale).landing;
  reply.type("text/html").send(
    pageShell(
      p.title,
      "/",
      locale,
      `${heroGraphic}
  <h1>${p.heading}</h1>
  <p class="vision">${p.vision}</p>
  <p class="intro">${p.intro}</p>
  <div class="usage">
    <div class="card">
      <h2>${p.claudeHeading}</h2>
      <ol>${p.claudeSteps.map((step) => `<li>${step}</li>`).join("")}</ol>
    </div>
    <div class="card">
      <h2>${p.chatgptHeading}</h2>
      <ol>${p.chatgptSteps.map((step) => `<li>${step}</li>`).join("")}</ol>
    </div>
  </div>`,
    ),
  );
});

function notFoundPage(reply: FastifyReply, req: FastifyRequest) {
  const locale = resolveRequestLocale(req, reply);
  const p = t(locale).notFound;
  reply
    .code(404)
    .type("text/html")
    .send(pageShell(p.title, req.url.split("?")[0], locale, `<h1>${p.heading}</h1><p class="intro">${p.body}</p>`));
}

async function loadPublicProfile(number: bigint) {
  const [row] = await db
    .select({
      number: accounts.number,
      nickname: accounts.nickname,
      status: accounts.status,
      tier: accounts.tier,
      description: agentCards.description,
      capabilities: agentCards.capabilities,
      orgName: agentCards.orgName,
      orgUrl: agentCards.orgUrl,
      languages: agentCards.languages,
      visibility: agentCards.visibility,
    })
    .from(accounts)
    .innerJoin(agentCards, eq(agentCards.number, accounts.number))
    .where(and(eq(accounts.number, number), eq(accounts.status, "active")))
    .limit(1);
  return row ?? null;
}

app.get("/@:number", async (req, reply) => {
  const { number } = req.params as { number: string };
  return reply.redirect(`/${number}`, 301);
});

app.get<{ Params: { number: string } }>("/:number(^[0-9]+$)", async (req, reply) => {
  const number = BigInt(req.params.number);
  const profile = await loadPublicProfile(number);
  if (!profile || profile.visibility === "unlisted") {
    return notFoundPage(reply, req);
  }

  const locale = resolveRequestLocale(req, reply);
  const p = t(locale).profile;
  const nickname = escapeHtml(profile.nickname);
  const description = profile.description ? escapeHtml(profile.description) : "";
  const capabilities = profile.capabilities as string[];

  reply.type("text/html").send(
    pageShell(
      `${formatNumber(profile.number)} ${nickname} — weid.ai`,
      `/${profile.number}`,
      locale,
      `<h1>${formatNumber(profile.number)}</h1>
  <p class="vision">${nickname}</p>
  <div class="card">
    ${description ? `<p>${description}</p>` : ""}
    ${capabilities.length ? `<h2>${p.capabilitiesLabel}</h2><p>${capabilities.map(escapeHtml).join(", ")}</p>` : ""}
  </div>
  <p class="intro">${p.addFriendInstruction(formatNumber(profile.number))}</p>
  <p class="intro"><a href="/a/${profile.number}/agent-card.json">agent-card.json</a></p>`,
    ),
  );
});

app.get<{ Params: { number: string } }>("/a/:number(^[0-9]+$)/agent-card.json", async (req, reply) => {
  const number = BigInt(req.params.number);
  const profile = await loadPublicProfile(number);
  if (!profile || profile.visibility === "unlisted") {
    return reply.code(404).send({ error: "not found" });
  }

  return {
    number: profile.number.toString(),
    name: profile.nickname,
    description: profile.description ?? "",
    capabilities: profile.capabilities,
    organization: profile.orgName ? { name: profile.orgName, url: profile.orgUrl ?? undefined } : undefined,
    languages: profile.languages,
    tier: profile.tier,
    url: `https://weid.ai/${profile.number}`,
  };
});

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(number: bigint): string {
  return `WEID-${number}`;
}

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

app
  .listen({ port, host })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
