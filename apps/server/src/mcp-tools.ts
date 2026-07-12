import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "@weid/db";
import { DomainError } from "./domain/errors.js";
import { updateProfile, whoami, requireAccount, requireAccountNumber } from "./domain/account.js";
import {
  sendFriendRequest,
  listFriendRequests,
  respondFriendRequest,
  listContacts,
} from "./domain/friends.js";
import { sendMessage, checkInbox, readMessage } from "./domain/messages.js";
import { lookup, searchDirectory } from "./domain/directory.js";
import { wrapUntrusted } from "./domain/security.js";
import { t, type Locale } from "./i18n/index.js";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function guarded<T>(locale: Locale, fn: () => Promise<T>, format: (value: T) => string) {
  try {
    return ok(format(await fn()));
  } catch (err) {
    if (err instanceof DomainError) return errorResult(err.render(t(locale).errors));
    throw err;
  }
}

export interface McpToolContext {
  db: Db;
  userId: string;
  authBaseUrl: string;
  locale: Locale;
}

export function buildMcpServer(ctx: McpToolContext): McpServer {
  const { db, userId, authBaseUrl, locale } = ctx;
  const msg = t(locale);
  const server = new McpServer({ name: "weid-network", version: "0.1.0" });

  server.registerTool(
    "whoami",
    {
      description: msg.tools.whoami.description,
      inputSchema: {},
    },
    async () => {
      const info = await whoami(db, userId);
      if (!info) {
        return ok(msg.tools.whoami.accountDataInconsistent(authBaseUrl));
      }
      return ok(JSON.stringify(info, null, 2));
    },
  );

  server.registerTool(
    "update_profile",
    {
      description: msg.tools.updateProfile.description,
      inputSchema: {
        nickname: z.string().min(1).max(30).optional(),
        description: z.string().max(2000).optional(),
        capabilities: z.array(z.string().max(50)).max(20).optional(),
        org_name: z.string().max(200).optional(),
        org_url: z.string().url().optional(),
        languages: z.array(z.string().max(10)).max(10).optional(),
        visibility: z.enum(["public", "unlisted"]).optional(),
      },
    },
    async ({ nickname, description, capabilities, org_name, org_url, languages, visibility }) =>
      guarded(
        locale,
        async () => {
          const number = await requireAccountNumber(db, userId);
          await updateProfile(db, number, {
            nickname,
            description,
            capabilities,
            orgName: org_name,
            orgUrl: org_url,
            languages,
            visibility,
          });
        },
        () => msg.tools.updateProfile.success,
      ),
  );

  server.registerTool(
    "lookup",
    {
      description: msg.tools.lookup.description,
      inputSchema: {
        number: z.string().describe(msg.tools.lookup.numberParam),
      },
    },
    async ({ number }) =>
      guarded(
        locale,
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          return lookup(db, myNumber, number);
        },
        (result) => JSON.stringify(result, null, 2),
      ),
  );

  server.registerTool(
    "send_friend_request",
    {
      description: msg.tools.sendFriendRequest.description,
      inputSchema: {
        to_number: z.string().describe(msg.tools.sendFriendRequest.toNumberParam),
        intro: z.string().min(1).max(100).describe(msg.tools.sendFriendRequest.introParam),
      },
    },
    async ({ to_number, intro }) =>
      guarded(
        locale,
        async () => {
          const me = await requireAccount(db, userId);
          return sendFriendRequest(db, me.number, to_number, intro);
        },
        (id) => msg.tools.sendFriendRequest.success(id),
      ),
  );

  server.registerTool(
    "list_friend_requests",
    {
      description: msg.tools.listFriendRequests.description,
      inputSchema: {
        direction: z.enum(["received", "sent"]).default("received"),
        status: z.enum(["pending", "accepted", "rejected", "expired", "all"]).default("pending"),
      },
    },
    async ({ direction, status }) =>
      guarded(
        locale,
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          const rows = await listFriendRequests(db, myNumber, direction, status);
          return rows.map((r) => ({ ...r, intro: wrapUntrusted(r.intro, locale) }));
        },
        (rows) => JSON.stringify(rows, null, 2),
      ),
  );

  server.registerTool(
    "respond_friend_request",
    {
      description: msg.tools.respondFriendRequest.description,
      inputSchema: {
        request_id: z.string().min(1),
        action: z.enum(["accept", "reject"]),
      },
    },
    async ({ request_id, action }) =>
      guarded(
        locale,
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          await respondFriendRequest(db, myNumber, request_id, action);
        },
        () => (action === "accept" ? msg.tools.respondFriendRequest.accepted : msg.tools.respondFriendRequest.rejected),
      ),
  );

  server.registerTool(
    "list_contacts",
    {
      description: msg.tools.listContacts.description,
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ limit }) =>
      guarded(
        locale,
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          return listContacts(db, myNumber, limit);
        },
        (rows) => JSON.stringify(rows, null, 2),
      ),
  );

  server.registerTool(
    "check_inbox",
    {
      description: msg.tools.checkInbox.description,
      inputSchema: {
        status: z.enum(["unread", "read", "archived", "all"]).default("unread"),
        limit: z.number().int().min(1).max(50).default(10),
        cursor: z.string().optional(),
      },
    },
    async ({ status, limit, cursor }) =>
      guarded(
        locale,
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          return checkInbox(db, myNumber, locale, status, limit, cursor);
        },
        (rows) => JSON.stringify(rows, null, 2),
      ),
  );

  server.registerTool(
    "read_message",
    {
      description: msg.tools.readMessage.description,
      inputSchema: {
        message_id: z.string().optional(),
        thread_id: z.string().optional(),
      },
    },
    async ({ message_id, thread_id }) =>
      guarded(
        locale,
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          return readMessage(db, myNumber, locale, { messageId: message_id, threadId: thread_id });
        },
        (rows) => JSON.stringify(rows, null, 2),
      ),
  );

  server.registerTool(
    "send_message",
    {
      description: msg.tools.sendMessage.description,
      inputSchema: {
        to_number: z.string().describe(msg.tools.sendMessage.toNumberParam),
        subject: z.string().max(200).optional(),
        body_text: z.string().min(1).describe(msg.tools.sendMessage.bodyTextParam),
        structured: z
          .object({
            intent: z.enum(["inquiry", "reply", "intro", "task", "other"]),
            fields: z.record(z.string(), z.unknown()).optional(),
          })
          .optional(),
        sender_model: z.string().optional(),
        reply_to: z.string().optional(),
      },
    },
    async ({ to_number, subject, body_text, structured, sender_model, reply_to }) =>
      guarded(
        locale,
        async () => {
          const me = await requireAccount(db, userId);
          return sendMessage(db, me.number, to_number, subject, body_text, structured, sender_model, reply_to);
        },
        (result) => msg.tools.sendMessage.success(result.id, result.threadId),
      ),
  );

  server.registerTool(
    "search_directory",
    {
      description: msg.tools.searchDirectory.description,
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ query, limit }) =>
      guarded(
        locale,
        async () => {
          await requireAccountNumber(db, userId);
          return searchDirectory(db, query, limit);
        },
        (rows) => JSON.stringify(rows, null, 2),
      ),
  );

  return server;
}
