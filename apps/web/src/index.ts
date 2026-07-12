import Fastify from "fastify";
import { createDb, accounts, agentCards } from "@weid/db";
import { eq, and } from "drizzle-orm";
import { pickLocale, t } from "./i18n.js";

const app = Fastify({ logger: true });

const databaseUrl = process.env.DATABASE_URL ?? "postgres://weid:weid@localhost:5432/weid";
const db = createDb(databaseUrl);

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
    padding: 4rem 1.5rem 5rem;
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
`;

// A small hub-and-spoke network — the same motif used across weid.ai's
// branding (see assets/icon.png) — as the one visual anchor on the page.
const heroGraphic = `<svg class="hero-graphic" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">
  <line x1="70" y1="40" x2="35" y2="90" stroke="#3d5a80" stroke-width="4"/>
  <line x1="70" y1="40" x2="105" y2="90" stroke="#3d5a80" stroke-width="4"/>
  <line x1="35" y1="90" x2="70" y2="105" stroke="#3d5a80" stroke-width="4"/>
  <line x1="105" y1="90" x2="70" y2="105" stroke="#3d5a80" stroke-width="4"/>
  <circle cx="70" cy="40" r="10" fill="#e6e9f5"/>
  <circle cx="35" cy="90" r="8" fill="#e6e9f5"/>
  <circle cx="105" cy="90" r="8" fill="#e6e9f5"/>
  <circle cx="70" cy="105" r="12" fill="#63b3ed"/>
</svg>`;

function pageShell(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${styles}</style></head>
<body><div class="wrap">${body}</div></body></html>`;
}

app.get("/healthz", async () => {
  return { status: "ok" };
});

app.get("/", async (req, reply) => {
  const p = t(pickLocale(req.headers["accept-language"])).landing;
  reply.type("text/html").send(
    pageShell(
      p.title,
      `${heroGraphic}
  <h1>${p.heading}</h1>
  <p class="vision">${p.vision}</p>
  <p class="intro">${p.intro}</p>`,
    ),
  );
});

function notFoundPage(reply: import("fastify").FastifyReply, req: import("fastify").FastifyRequest) {
  const p = t(pickLocale(req.headers["accept-language"])).notFound;
  reply
    .code(404)
    .type("text/html")
    .send(pageShell(p.title, `<h1>${p.heading}</h1><p class="intro">${p.body}</p>`));
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

  const p = t(pickLocale(req.headers["accept-language"])).profile;
  const nickname = escapeHtml(profile.nickname);
  const description = profile.description ? escapeHtml(profile.description) : "";
  const capabilities = profile.capabilities as string[];

  reply.type("text/html").send(
    pageShell(
      `${formatNumber(profile.number)} ${nickname} — weid.ai`,
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
