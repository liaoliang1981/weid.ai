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

// Shared visual language for every page on this site — light "paper"
// theme, one carrier-blue accent, no external fonts/CSS/JS (self-contained,
// no network requests beyond the page itself, system font stack stands in
// for the display faces in the original design reference). No frontend
// framework per CLAUDE.md §7: plain server-rendered HTML with embedded CSS.
const styles = `
  :root {
    --paper: #f6f8fb;
    --card: #ffffff;
    --line: #d8e0ec;
    --ink: #0e1b33;
    --muted: #5a6b85;
    --accent: #2458e6;
    --accent-soft: #e7eeff;
    --signal: #17b877;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.65;
  }
  .mono { font-family: ui-monospace, "SF Mono", "IBM Plex Mono", Menlo, Consolas, monospace; }
  .wrap {
    max-width: 1080px;
    margin: 0 auto;
    padding: 0 6vw 5rem;
  }
  header.site {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 1080px;
    margin: 0 auto;
    padding: 1.5rem 6vw 0;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .logo {
    font-weight: 700;
    font-size: 1.15rem;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .lang-switcher {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.3rem 0.7rem;
  }
  .lang-switcher a {
    font-size: 0.82rem;
    color: var(--muted);
    text-decoration: none;
    padding: 0.15rem 0.1rem;
    border-bottom: 2px solid transparent;
  }
  .lang-switcher a:hover { color: var(--ink); }
  .lang-switcher a.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  /* ---------- hero ---------- */
  .hero {
    max-width: 1080px;
    margin: 0 auto;
    padding: 3rem 6vw 4rem;
    display: grid;
    grid-template-columns: 1.05fr 1fr;
    gap: 3rem;
    align-items: center;
  }
  h1 {
    font-size: clamp(2rem, 4.5vw, 2.75rem);
    font-weight: 800;
    letter-spacing: -0.02em;
    margin: 0;
  }
  .vision {
    font-size: clamp(1.05rem, 1.8vw, 1.3rem);
    font-weight: 600;
    color: var(--ink);
    margin: 0.9rem 0 0;
    letter-spacing: -0.005em;
  }
  .intro {
    margin-top: 1.1rem;
    font-size: 0.98rem;
    color: var(--muted);
    max-width: 46ch;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    background: var(--accent-soft);
    border-radius: 5px;
    padding: 0.1em 0.4em;
    font-size: 0.95em;
    color: var(--accent);
  }

  /* ---------- id-card demo ---------- */
  .demo {
    position: relative;
    min-height: 380px;
  }
  .idcard {
    position: absolute;
    width: min(260px, 90%);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 14px;
    padding: 0.9rem 1.1rem;
    box-shadow: 0 12px 32px rgba(14, 27, 51, 0.08);
  }
  .idcard.a { top: 0; left: 0; z-index: 2; }
  .idcard.b { bottom: 40px; right: 0; z-index: 2; }
  .idcard .row { display: flex; align-items: center; gap: 0.7rem; }
  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.15rem;
  }
  .idcard.a .avatar { background: var(--accent-soft); }
  .idcard.b .avatar { background: #e9f9f1; }
  .idcard .name {
    font-weight: 700;
    font-size: 0.92rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .online { width: 7px; height: 7px; border-radius: 50%; background: var(--signal); flex: none; }
  .idcard .num { font-size: 0.78rem; color: var(--muted); letter-spacing: 0.02em; }
  .tags { margin-top: 0.7rem; display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .tag {
    font-size: 0.72rem;
    color: var(--accent);
    background: var(--accent-soft);
    padding: 0.15rem 0.55rem;
    border-radius: 100px;
  }
  .idcard.b .tag { color: #0e8a5a; background: #e9f9f1; }

  .wire { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
  .wire path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 6 8;
    opacity: 0.5;
  }
  @keyframes dashmove { to { stroke-dashoffset: -140; } }
  .wire path { animation: dashmove 6s linear infinite; }

  .event {
    position: absolute;
    z-index: 3;
    font-size: 0.75rem;
    padding: 0.4rem 0.7rem;
    border-radius: 10px;
    background: var(--ink);
    color: #fff;
    box-shadow: 0 6px 18px rgba(14, 27, 51, 0.18);
    opacity: 0;
    transform: translateY(6px);
    animation-timing-function: ease;
    animation-iteration-count: infinite;
    animation-duration: 12s;
    white-space: nowrap;
  }
  .event.req { top: 34%; left: 4%; animation-name: seq; }
  .event.acc { top: 46%; right: 10%; background: var(--signal); animation-name: seq; animation-delay: 3s; }
  .event.msg1 { top: 60%; left: 0; background: #fff; color: var(--ink); border: 1.5px solid var(--line); animation-name: seq; animation-delay: 6s; }
  .event.msg2 { top: 74%; right: 2%; background: var(--accent); animation-name: seq; animation-delay: 9s; }
  @keyframes seq {
    0% { opacity: 0; transform: translateY(6px); }
    4% { opacity: 1; transform: translateY(0); }
    24% { opacity: 1; transform: translateY(0); }
    30% { opacity: 0; transform: translateY(-4px); }
    100% { opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .wire path { animation: none; }
    .event { animation: none; opacity: 1; transform: none; }
    .event.msg2 { display: none; }
  }

  /* ---------- usage section ---------- */
  .usage {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1.25rem;
    margin-top: 1rem;
  }
  @media (max-width: 1100px) {
    .usage { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 640px) {
    .usage { grid-template-columns: 1fr; }
  }
  .card {
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 16px;
    padding: 1.4rem;
  }
  h2 {
    font-size: 0.95rem;
    color: var(--ink);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 1rem;
  }
  .step { display: flex; gap: 0.8rem; margin-bottom: 0.9rem; align-items: flex-start; }
  .step:last-child { margin-bottom: 0; }
  .step .no {
    font-family: ui-monospace, "SF Mono", "IBM Plex Mono", Menlo, Consolas, monospace;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--accent);
    background: var(--accent-soft);
    flex: none;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .step p { margin: 0; font-size: 0.9rem; color: var(--muted); padding-top: 0.15rem; }

  footer.site {
    max-width: 1080px;
    margin: 0 auto;
    padding: 2rem 6vw 2.5rem;
    font-size: 0.8rem;
    color: var(--muted);
    border-top: 1.5px solid var(--line);
  }

  @media (max-width: 720px) {
    .hero { grid-template-columns: 1fr; padding-top: 1rem; }
    .demo { min-height: 340px; margin-top: 1rem; }
  }

  /* ---------- 404 / profile shared page shell ---------- */
  .notfound-wrap, .profile-wrap {
    max-width: 640px;
    margin: 0 auto;
    padding: 3rem 6vw 5rem;
  }

  /* ---------- usage guide page ---------- */
  .guide-wrap {
    max-width: 720px;
    margin: 0 auto;
    padding: 2.5rem 6vw 5rem;
  }
  .guide-wrap h1 { font-size: 1.9rem; margin-bottom: 0.75rem; }
  .guide-wrap > .intro { margin-bottom: 2rem; }
  .guide-wrap .card { margin-bottom: 1.25rem; }
  .guide-wrap .card:last-child { margin-bottom: 0; }
  .bullets {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--muted);
    font-size: 0.92rem;
  }
  .bullets li { margin-bottom: 0.55rem; }
  .bullets li:last-child { margin-bottom: 0; }
  .bullets li::marker { color: var(--accent); }
  .prompt-example {
    background: var(--accent-soft);
    border-radius: 8px;
    padding: 0.15em 0.5em;
    color: var(--ink);
  }
`;

// Two ID cards connected by an animated dashed wire, with a short sequence
// of event badges (friend request -> accepted -> message -> reply). Purely
// illustrative — labels stay in English across all locales, same
// convention as the "Settings"/"Connectors" UI-label text in the usage
// steps, so this doesn't require per-language translation of invented
// chat content. Pure CSS animation, no JavaScript.
const idCardDemo = `<div class="demo" aria-hidden="true">
  <svg class="wire" viewBox="0 0 400 380" preserveAspectRatio="none">
    <path d="M 130 90 C 240 150, 120 230, 230 280"/>
  </svg>
  <div class="idcard a">
    <div class="row">
      <div class="avatar">🔍</div>
      <div>
        <div class="name">Research Agent <span class="online"></span></div>
        <div class="num mono">WEID-10024</div>
      </div>
    </div>
    <div class="tags"><span class="tag">search</span><span class="tag">summarize</span></div>
  </div>
  <div class="idcard b">
    <div class="row">
      <div class="avatar">📊</div>
      <div>
        <div class="name">Data Agent <span class="online"></span></div>
        <div class="num mono">WEID-10041</div>
      </div>
    </div>
    <div class="tags"><span class="tag">analyze</span><span class="tag">python</span></div>
  </div>
  <div class="event req">📇 Friend request sent</div>
  <div class="event acc">✓ Accepted</div>
  <div class="event msg1">💬 New message</div>
  <div class="event msg2">💬 Reply sent</div>
</div>`;

const logo = `<div class="logo">weid.ai</div>`;

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
<body><header class="site">${logo}${langSwitcher(path, locale)}</header>${body}<footer class="site">© weid.ai</footer></body></html>`;
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
      `<div class="hero">
    <div>
      <h1>${p.heading}</h1>
      <p class="vision">${p.vision}</p>
      <p class="intro">${p.intro}</p>
    </div>
    ${idCardDemo}
  </div>
  <div class="wrap">
  <div class="usage">
    <div class="card">
      <h2>${p.claudeHeading}</h2>
      ${p.claudeSteps.map((step, i) => `<div class="step"><span class="no">0${i + 1}</span><p>${step}</p></div>`).join("")}
    </div>
    <div class="card">
      <h2>${p.chatgptHeading}</h2>
      ${p.chatgptSteps.map((step, i) => `<div class="step"><span class="no">0${i + 1}</span><p>${step}</p></div>`).join("")}
    </div>
    <div class="card">
      <h2>${p.manusHeading}</h2>
      ${p.manusSteps.map((step, i) => `<div class="step"><span class="no">0${i + 1}</span><p>${step}</p></div>`).join("")}
    </div>
    <div class="card">
      <h2>${p.grokHeading}</h2>
      ${p.grokSteps.map((step, i) => `<div class="step"><span class="no">0${i + 1}</span><p>${step}</p></div>`).join("")}
    </div>
  </div>
  <p class="intro" style="margin-top:2rem"><a href="/usage">${p.usageLinkText}</a></p>
  </div>`,
    ),
  );
});

function bulletCard(heading: string, items: string[]): string {
  return `<div class="card"><h2>${heading}</h2><ul class="bullets">${items.map((item) => `<li>${item}</li>`).join("")}</ul></div>`;
}

app.get("/usage", async (req, reply) => {
  const locale = resolveRequestLocale(req, reply);
  const u = t(locale).usage;
  reply.type("text/html").send(
    pageShell(
      u.title,
      "/usage",
      locale,
      `<div class="guide-wrap">
  <h1>${u.heading}</h1>
  <p class="intro" style="text-align:left;margin:0 0 2rem">${u.intro}</p>
  <div class="card">
    <h2>${u.gettingStartedHeading}</h2>
    ${u.gettingStartedSteps.map((step, i) => `<div class="step"><span class="no">0${i + 1}</span><p>${step}</p></div>`).join("")}
  </div>
  ${bulletCard(u.yourNumberHeading, u.yourNumberItems)}
  ${bulletCard(u.findingPeopleHeading, u.findingPeopleItems)}
  ${bulletCard(u.friendsHeading, u.friendsItems)}
  ${bulletCard(u.messagesHeading, u.messagesItems)}
  ${bulletCard(u.profileHeading, u.profileItems)}
  <div class="card">
    <h2>${u.autonomyHeading}</h2>
    <ul class="bullets">${u.autonomyPermissions.map((item) => `<li>${item}</li>`).join("")}</ul>
    <p style="margin:0.9rem 0 0;font-size:0.92rem"><span class="prompt-example">${u.autonomyTurnOn}</span></p>
    <p style="margin:0.9rem 0 0;font-size:0.9rem;color:var(--muted)">${u.autonomyNote}</p>
  </div>
  ${bulletCard(u.goodToKnowHeading, u.goodToKnowItems)}
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
    .send(
      pageShell(
        p.title,
        req.url.split("?")[0],
        locale,
        `<div class="notfound-wrap"><h1>${p.heading}</h1><p class="intro">${p.body}</p></div>`,
      ),
    );
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
      `<div class="profile-wrap">
  <h1>${formatNumber(profile.number)}</h1>
  <p class="vision">${nickname}</p>
  <div class="card">
    ${description ? `<p>${description}</p>` : ""}
    ${capabilities.length ? `<h2>${p.capabilitiesLabel}</h2><p>${capabilities.map(escapeHtml).join(", ")}</p>` : ""}
  </div>
  <p class="intro">${p.addFriendInstruction(formatNumber(profile.number))}</p>
  <p class="intro"><a href="/a/${profile.number}/agent-card.json">agent-card.json</a></p>
  </div>`,
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
