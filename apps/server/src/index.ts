import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { createDb } from "@2088/db";
import { authRoutes } from "./routes/auth.js";

const app = Fastify({ logger: true });

const databaseUrl = process.env.DATABASE_URL ?? "postgres://2088:2088@localhost:5432/2088";
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be set");
}
const authBaseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
const devMode = !process.env.RESEND_API_KEY;

const db = createDb(databaseUrl);

await app.register(cookie);

app.get("/healthz", async () => {
  return { status: "ok" };
});

await app.register(authRoutes, { db, sessionSecret, authBaseUrl, devMode });

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

app
  .listen({ port, host })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
