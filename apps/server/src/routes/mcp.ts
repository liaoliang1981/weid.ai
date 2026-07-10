import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Db } from "@weid/db";
import { verifyAccessToken } from "./oauth.js";
import { buildMcpServer } from "../mcp-tools.js";

const JSON_RPC_UNAUTHORIZED = {
  jsonrpc: "2.0",
  error: { code: -32001, message: "未授权，请提供有效的 Bearer token / unauthorized, provide a valid Bearer token" },
  id: null,
};

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0",
  error: { code: -32000, message: "Method not allowed." },
  id: null,
};

export interface McpRouteOptions {
  db: Db;
  mcpUrl: string;
  authBaseUrl: string;
}

export async function mcpRoutes(app: FastifyInstance, opts: McpRouteOptions) {
  const { db, mcpUrl, authBaseUrl } = opts;
  const wwwAuthenticate = `Bearer realm="weid.ai", resource_metadata="${mcpUrl}/.well-known/oauth-protected-resource"`;
  // MCP clients (e.g. claude.ai) treat the connector URL itself as the full
  // endpoint and POST straight to it with no path — so the JSON-RPC handler
  // must also live at "/" on the mcp.* host, not just at "/mcp". Constrained
  // to that host so auth.weid.ai's "/" (the register/login chooser) is
  // unaffected; "/mcp" stays registered too for local testing/back-compat.
  //
  // Locally MCP_URL and AUTH_URL both collapse to the same localhost:PORT,
  // so the constraint would shadow the auth chooser at "/" — only register
  // the constrained duplicate when the two are genuinely different hosts.
  const mcpHost = new URL(mcpUrl).host;
  const authHost = new URL(authBaseUrl).host;
  const hasDistinctMcpHost = mcpHost !== authHost;

  async function handlePost(req: FastifyRequest, reply: FastifyReply) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const verified = token ? await verifyAccessToken(db, token) : null;
    if (!verified) {
      reply.code(401).header("WWW-Authenticate", wwwAuthenticate).send(JSON_RPC_UNAUTHORIZED);
      return;
    }

    reply.hijack();
    const server = buildMcpServer({ db, userId: verified.userId });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      (req.raw as typeof req.raw & { auth?: unknown }).auth = {
        token,
        clientId: verified.clientId,
        scopes: verified.scope ? verified.scope.split(" ") : [],
      };
      await transport.handleRequest(req.raw, reply.raw, req.body);
      reply.raw.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      req.log.error(err, "error handling MCP request");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      }
    }
  }

  async function methodNotAllowed(_req: FastifyRequest, reply: FastifyReply) {
    reply.code(405).send(METHOD_NOT_ALLOWED);
  }

  app.post("/mcp", handlePost);
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  if (hasDistinctMcpHost) {
    app.post("/", { constraints: { host: mcpHost } }, handlePost);
    app.get("/", { constraints: { host: mcpHost } }, methodNotAllowed);
    app.delete("/", { constraints: { host: mcpHost } }, methodNotAllowed);
  }
}
