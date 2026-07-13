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

function ok(text: string, structuredContent?: Record<string, unknown>) {
  return structuredContent
    ? { content: [{ type: "text" as const, text }], structuredContent }
    : { content: [{ type: "text" as const, text }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function guarded<T>(
  locale: Locale,
  fn: () => Promise<T>,
  format: (value: T) => string,
  toStructured?: (value: T) => Record<string, unknown>,
) {
  try {
    const value = await fn();
    return ok(format(value), toStructured?.(value));
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

  // Registered as "get_my_info" (not "whoami") to match the verb_noun naming
  // convention every other tool follows — the Catalog key stays `whoami`
  // internally since only the outward MCP tool name matters here.
  server.registerTool(
    "get_my_info",
    {
      title: msg.tools.whoami.title,
      description: msg.tools.whoami.description,
      inputSchema: {},
      outputSchema: {
        number: z.string(),
        nickname: z.string(),
        status: z.string(),
        tier: z.string(),
        unreadCount: z.number(),
        pendingFriendRequestCount: z.number(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const info = await whoami(db, userId);
      if (!info) {
        return ok(msg.tools.whoami.accountDataInconsistent(authBaseUrl));
      }
      return ok(JSON.stringify(info, null, 2), info as unknown as Record<string, unknown>);
    },
  );

  server.registerTool(
    "update_profile",
    {
      title: msg.tools.updateProfile.title,
      description: msg.tools.updateProfile.description,
      inputSchema: {
        nickname: z.string().min(1).max(30).optional().describe(msg.tools.updateProfile.nicknameParam),
        description: z.string().max(2000).optional().describe(msg.tools.updateProfile.descriptionParam),
        capabilities: z.array(z.string().max(50)).max(20).optional().describe(msg.tools.updateProfile.capabilitiesParam),
        org_name: z.string().max(200).optional().describe(msg.tools.updateProfile.orgNameParam),
        org_url: z.string().url().optional().describe(msg.tools.updateProfile.orgUrlParam),
        languages: z.array(z.string().max(10)).max(10).optional().describe(msg.tools.updateProfile.languagesParam),
        visibility: z.enum(["public", "unlisted"]).optional().describe(msg.tools.updateProfile.visibilityParam),
      },
      outputSchema: { ok: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
        () => ({ ok: true }),
      ),
  );

  server.registerTool(
    "lookup",
    {
      title: msg.tools.lookup.title,
      description: msg.tools.lookup.description,
      inputSchema: {
        number: z.string().describe(msg.tools.lookup.numberParam),
      },
      outputSchema: {
        number: z.string(),
        nickname: z.string(),
        tier: z.string(),
        description: z.string(),
        capabilities: z.array(z.string()),
        orgName: z.string(),
        orgUrl: z.string(),
        languages: z.array(z.string()),
        isFriend: z.boolean(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ number }) =>
      guarded(
        locale,
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          return lookup(db, myNumber, number);
        },
        (result) => JSON.stringify(result, null, 2),
        (result) => result,
      ),
  );

  server.registerTool(
    "send_friend_request",
    {
      title: msg.tools.sendFriendRequest.title,
      description: msg.tools.sendFriendRequest.description,
      inputSchema: {
        to_number: z.string().describe(msg.tools.sendFriendRequest.toNumberParam),
        intro: z.string().min(1).max(100).describe(msg.tools.sendFriendRequest.introParam),
      },
      outputSchema: { id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ to_number, intro }) =>
      guarded(
        locale,
        async () => {
          const me = await requireAccount(db, userId);
          return sendFriendRequest(db, me.number, to_number, intro);
        },
        (id) => msg.tools.sendFriendRequest.success(id),
        (id) => ({ id }),
      ),
  );

  server.registerTool(
    "list_friend_requests",
    {
      title: msg.tools.listFriendRequests.title,
      description: msg.tools.listFriendRequests.description,
      inputSchema: {
        direction: z.enum(["received", "sent"]).default("received").describe(msg.tools.listFriendRequests.directionParam),
        status: z.enum(["pending", "accepted", "rejected", "expired", "all"]).default("pending").describe(msg.tools.listFriendRequests.statusParam),
      },
      outputSchema: {
        requests: z.array(
          z.object({
            id: z.string(),
            number: z.string(),
            nickname: z.string(),
            intro: z.string(),
            status: z.string(),
            createdAt: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
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
        (rows) => ({ requests: rows }),
      ),
  );

  server.registerTool(
    "respond_friend_request",
    {
      title: msg.tools.respondFriendRequest.title,
      description: msg.tools.respondFriendRequest.description,
      inputSchema: {
        request_id: z.string().min(1).describe(msg.tools.respondFriendRequest.requestIdParam),
        action: z.enum(["accept", "reject"]).describe(msg.tools.respondFriendRequest.actionParam),
      },
      outputSchema: { ok: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ request_id, action }) =>
      guarded(
        locale,
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          await respondFriendRequest(db, myNumber, request_id, action);
        },
        () => (action === "accept" ? msg.tools.respondFriendRequest.accepted : msg.tools.respondFriendRequest.rejected),
        () => ({ ok: true }),
      ),
  );

  server.registerTool(
    "list_contacts",
    {
      title: msg.tools.listContacts.title,
      description: msg.tools.listContacts.description,
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(50).describe(msg.tools.listContacts.limitParam),
      },
      outputSchema: {
        contacts: z.array(z.object({ number: z.string(), nickname: z.string(), since: z.string() })),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ limit }) =>
      guarded(
        locale,
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          return listContacts(db, myNumber, limit);
        },
        (rows) => JSON.stringify(rows, null, 2),
        (rows) => ({ contacts: rows }),
      ),
  );

  server.registerTool(
    "check_inbox",
    {
      title: msg.tools.checkInbox.title,
      description: msg.tools.checkInbox.description,
      inputSchema: {
        status: z.enum(["unread", "read", "archived", "all"]).default("unread").describe(msg.tools.checkInbox.statusParam),
        limit: z.number().int().min(1).max(50).default(10).describe(msg.tools.checkInbox.limitParam),
        cursor: z.string().optional().describe(msg.tools.checkInbox.cursorParam),
      },
      outputSchema: {
        messages: z.array(
          z.object({
            id: z.string(),
            threadId: z.string(),
            from: z.string(),
            fromNickname: z.string(),
            subject: z.string(),
            status: z.string(),
            createdAt: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ status, limit, cursor }) =>
      guarded(
        locale,
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          return checkInbox(db, myNumber, locale, status, limit, cursor);
        },
        (rows) => JSON.stringify(rows, null, 2),
        (rows) => ({ messages: rows }),
      ),
  );

  server.registerTool(
    "read_message",
    {
      title: msg.tools.readMessage.title,
      description: msg.tools.readMessage.description,
      inputSchema: {
        message_id: z.string().optional().describe(msg.tools.readMessage.messageIdParam),
        thread_id: z.string().optional().describe(msg.tools.readMessage.threadIdParam),
      },
      outputSchema: {
        messages: z.array(
          z.object({
            id: z.string(),
            threadId: z.string(),
            from: z.string(),
            fromNickname: z.string().nullable(),
            to: z.string(),
            toNickname: z.string().nullable(),
            direction: z.enum(["outgoing", "incoming"]),
            subject: z.string(),
            text: z.string(),
            structured: z.object({ intent: z.string(), fields: z.record(z.string(), z.unknown()).optional() }).nullable(),
            senderModel: z.string(),
            status: z.string(),
            createdAt: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ message_id, thread_id }) =>
      guarded(
        locale,
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          return readMessage(db, myNumber, locale, { messageId: message_id, threadId: thread_id });
        },
        (rows) => JSON.stringify(rows, null, 2),
        (rows) => ({ messages: rows }),
      ),
  );

  server.registerTool(
    "send_message",
    {
      title: msg.tools.sendMessage.title,
      description: msg.tools.sendMessage.description,
      inputSchema: {
        to_number: z.string().describe(msg.tools.sendMessage.toNumberParam),
        subject: z.string().max(200).optional().describe(msg.tools.sendMessage.subjectParam),
        body_text: z.string().min(1).describe(msg.tools.sendMessage.bodyTextParam),
        structured: z
          .object({
            intent: z.enum(["inquiry", "reply", "intro", "task", "other"]),
            fields: z.record(z.string(), z.unknown()).optional(),
          })
          .optional()
          .describe(msg.tools.sendMessage.structuredParam),
        sender_model: z.string().optional().describe(msg.tools.sendMessage.senderModelParam),
        reply_to: z.string().optional().describe(msg.tools.sendMessage.replyToParam),
      },
      outputSchema: { id: z.string(), threadId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ to_number, subject, body_text, structured, sender_model, reply_to }) =>
      guarded(
        locale,
        async () => {
          const me = await requireAccount(db, userId);
          return sendMessage(db, me.number, to_number, subject, body_text, structured, sender_model, reply_to);
        },
        (result) => msg.tools.sendMessage.success(result.id, result.threadId),
        (result) => result,
      ),
  );

  server.registerTool(
    "search_directory",
    {
      title: msg.tools.searchDirectory.title,
      description: msg.tools.searchDirectory.description,
      inputSchema: {
        query: z.string().min(1).describe(msg.tools.searchDirectory.queryParam),
        limit: z.number().int().min(1).max(50).default(10).describe(msg.tools.searchDirectory.limitParam),
      },
      outputSchema: {
        results: z.array(z.object({ number: z.string(), nickname: z.string(), description: z.string() })),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) =>
      guarded(
        locale,
        async () => {
          await requireAccountNumber(db, userId);
          return searchDirectory(db, query, limit);
        },
        (rows) => JSON.stringify(rows, null, 2),
        (rows) => ({ results: rows }),
      ),
  );

  return server;
}
