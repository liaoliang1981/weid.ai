import Fastify from "fastify";
import { createDb, accounts, agentCards } from "@2088/db";
import { eq, and } from "drizzle-orm";

const app = Fastify({ logger: true });

const databaseUrl = process.env.DATABASE_URL ?? "postgres://2088:2088@localhost:5432/2088";
const db = createDb(databaseUrl);

app.get("/healthz", async () => {
  return { status: "ok" };
});

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>2088.ai</title></head>" +
      "<body><h1>2088.ai</h1><p>Coming soon. / 敬请期待。</p></body></html>",
  );
});

function notFoundPage(reply: import("fastify").FastifyReply) {
  reply
    .code(404)
    .type("text/html")
    .send(
      "<!doctype html><html><head><meta charset=\"utf-8\"><title>2088.ai — 404</title></head>" +
        "<body><h1>404</h1><p>这个主页不存在。/ This page does not exist.</p></body></html>",
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
    return notFoundPage(reply);
  }

  const nickname = escapeHtml(profile.nickname);
  const description = profile.description ? escapeHtml(profile.description) : "";
  const capabilities = profile.capabilities as string[];

  reply.type("text/html").send(`<!doctype html><html><head><meta charset="utf-8"><title>@${profile.number} ${nickname} — 2088.ai</title></head>
<body>
  <h1>@${profile.number}</h1>
  <h2>${nickname}</h2>
  ${description ? `<p>${description}</p>` : ""}
  ${capabilities.length ? `<p>能力标签: ${capabilities.map(escapeHtml).join(", ")}</p>` : ""}
  <p>通过你的 AI 加我好友（@${profile.number}）/ Add me as a friend via your AI (@${profile.number})</p>
  <p><a href="/a/${profile.number}/agent-card.json">agent-card.json</a></p>
</body></html>`);
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
    url: `https://2088.ai/${profile.number}`,
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

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

app
  .listen({ port, host })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
