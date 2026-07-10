import type { FastifyInstance } from "fastify";
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
}

export async function mcpRoutes(app: FastifyInstance, opts: McpRouteOptions) {
  const { db, mcpUrl } = opts;
  const wwwAuthenticate = `Bearer realm="weid.ai", resource_metadata="${mcpUrl}/.well-known/oauth-protected-resource"`;

  app.post("/mcp", async (req, reply) => {
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
  });

  app.get("/mcp", async (_req, reply) => {
    reply.code(405).send(METHOD_NOT_ALLOWED);
  });

  app.delete("/mcp", async (_req, reply) => {
    reply.code(405).send(METHOD_NOT_ALLOWED);
  });
}
