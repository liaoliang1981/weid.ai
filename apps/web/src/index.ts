import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/healthz", async () => {
  return { status: "ok" };
});

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>2088.ai</title></head>" +
      "<body><h1>2088.ai</h1><p>Coming soon. / 敬请期待。</p></body></html>",
  );
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

app
  .listen({ port, host })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
