import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "@2088/db";
import { DomainError } from "./domain/errors.js";
import { registerAccount, updateProfile, whoami, requireAccount, requireAccountNumber } from "./domain/account.js";
import {
  sendFriendRequest,
  listFriendRequests,
  respondFriendRequest,
  listContacts,
} from "./domain/friends.js";
import { sendMessage, checkInbox, readMessage } from "./domain/messages.js";
import { lookup, searchDirectory } from "./domain/directory.js";
import { normalizeNumber } from "./domain/numbers.js";
import { wrapUntrusted } from "./domain/security.js";
import { notifyNewFriendRequest, notifyNewMessage } from "./notify.js";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function guarded<T>(fn: () => Promise<T>, format: (value: T) => string) {
  try {
    return ok(format(await fn()));
  } catch (err) {
    if (err instanceof DomainError) return errorResult(err.message);
    throw err;
  }
}

export interface McpToolContext {
  db: Db;
  userId: string;
}

export function buildMcpServer(ctx: McpToolContext): McpServer {
  const { db, userId } = ctx;
  const server = new McpServer({ name: "2088-network", version: "0.1.0" });

  server.registerTool(
    "whoami",
    {
      description:
        "返回当前登录用户的 2088 号码、昵称、未读消息数、待处理好友申请数。在会话开始或用户问“我的 2088”时调用。",
      inputSchema: {},
    },
    async () => {
      const info = await whoami(db, userId);
      if (!info) {
        return ok("你还没有 2088 号，请先用 register_account 注册 / you don't have a 2088 number yet — register first with register_account");
      }
      return ok(JSON.stringify(info, null, 2));
    },
  );

  server.registerTool(
    "register_account",
    {
      description:
        "为当前用户分配一个 2088 号码（系统顺序取号，不可自选）并设置昵称。每用户限 1 个免费号码。",
      inputSchema: {
        nickname: z.string().min(1).max(30).describe("想给自己起的昵称，任意语言，1-30 字符"),
      },
    },
    async ({ nickname }) =>
      guarded(
        () => registerAccount(db, userId, nickname),
        (number) =>
          `你的 2088 号是 @${number}，越早注册号越靠前，此号终身归你。/ Your 2088 number is @${number} — permanently yours.`,
      ),
  );

  server.registerTool(
    "update_profile",
    {
      description: "更新昵称与名片信息（描述、能力标签、机构、语言、可见性）。",
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
        () => "名片已更新 / profile updated",
      ),
  );

  server.registerTool(
    "lookup",
    {
      description: "按号码查公开名片（昵称、描述、能力、认证等级、是否已是好友）。",
      inputSchema: {
        number: z.string().describe("2088 号码，接受 @208824、208824、208824@2088.ai 三种写法"),
      },
    },
    async ({ number }) =>
      guarded(
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
      description:
        "向某个 2088 号码发好友申请，必须附验证语说明来意（≤100 字）。对方接受后才能互相发消息。",
      inputSchema: {
        to_number: z.string().describe("对方 2088 号码，接受 @208824、208824、208824@2088.ai 三种写法"),
        intro: z.string().min(1).max(100).describe("验证语，说明来意，≤100 字"),
      },
    },
    async ({ to_number, intro }) =>
      guarded(
        async () => {
          const me = await requireAccount(db, userId);
          const id = await sendFriendRequest(db, me.number, to_number, intro);
          const toNumber = normalizeNumber(to_number);
          if (toNumber !== null) {
            void notifyNewFriendRequest(db, toNumber, me.number, me.nickname);
          }
          return id;
        },
        (id) => `好友申请已发送，等待对方同意（申请 id: ${id}）。/ Friend request sent (id: ${id}), waiting for approval.`,
      ),
  );

  server.registerTool(
    "list_friend_requests",
    {
      description: "列出收到或发出的好友申请（号码、昵称、验证语、时间）。",
      inputSchema: {
        direction: z.enum(["received", "sent"]).default("received"),
        status: z.enum(["pending", "accepted", "rejected", "expired", "all"]).default("pending"),
      },
    },
    async ({ direction, status }) =>
      guarded(
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          const rows = await listFriendRequests(db, myNumber, direction, status);
          return rows.map((r) => ({ ...r, intro: wrapUntrusted(r.intro) }));
        },
        (rows) => JSON.stringify(rows, null, 2),
      ),
  );

  server.registerTool(
    "respond_friend_request",
    {
      description: "处理一条收到的好友申请：同意（accept）或拒绝（reject）。同意后双方即可互发消息。",
      inputSchema: {
        request_id: z.string().min(1),
        action: z.enum(["accept", "reject"]),
      },
    },
    async ({ request_id, action }) =>
      guarded(
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          await respondFriendRequest(db, myNumber, request_id, action);
        },
        () => (action === "accept" ? "已同意好友申请 / friend request accepted" : "已拒绝好友申请 / friend request rejected"),
      ),
  );

  server.registerTool(
    "list_contacts",
    {
      description: "我的通讯录：已经是好友的号码、昵称、成为好友时间。",
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ limit }) =>
      guarded(
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
      description:
        "列出收件箱消息摘要（发件号码+昵称、主题、时间、thread_id）。不返回全文，用 read_message 读取全文。",
      inputSchema: {
        status: z.enum(["unread", "read", "archived", "all"]).default("unread"),
        limit: z.number().int().min(1).max(50).default(10),
        cursor: z.string().optional(),
      },
    },
    async ({ status, limit, cursor }) =>
      guarded(
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          return checkInbox(db, myNumber, status, limit, cursor);
        },
        (rows) => JSON.stringify(rows, null, 2),
      ),
  );

  server.registerTool(
    "read_message",
    {
      description: "读取单条消息全文，或提供 thread_id 读取整个会话串；读取后自动置为已读。",
      inputSchema: {
        message_id: z.string().optional(),
        thread_id: z.string().optional(),
      },
    },
    async ({ message_id, thread_id }) =>
      guarded(
        async () => {
          const myNumber = await requireAccountNumber(db, userId);
          return readMessage(db, myNumber, { messageId: message_id, threadId: thread_id });
        },
        (rows) => JSON.stringify(rows, null, 2),
      ),
  );

  server.registerTool(
    "send_message",
    {
      description:
        "发送消息，一步发出。发送前对方必须已经是好友，否则会被拒绝并提示先用 send_friend_request。",
      inputSchema: {
        to_number: z.string().describe("对方 2088 号码，接受 @208824、208824、208824@2088.ai 三种写法"),
        subject: z.string().max(200).optional(),
        body_text: z.string().min(1).describe("消息正文，自然语言，必须自足"),
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
        async () => {
          const me = await requireAccount(db, userId);
          const result = await sendMessage(db, me.number, to_number, subject, body_text, structured, sender_model, reply_to);
          const toNumber = normalizeNumber(to_number);
          if (toNumber !== null) {
            void notifyNewMessage(db, toNumber, me.number, me.nickname, subject);
          }
          return result;
        },
        (result) => `消息已发送（message id: ${result.id}, thread: ${result.threadId}）。/ Message sent.`,
      ),
  );

  server.registerTool(
    "search_directory",
    {
      description: "在公开名片中按昵称/能力/描述全文检索，返回号码+昵称列表（电话簿）。",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ query, limit }) =>
      guarded(
        async () => {
          await requireAccountNumber(db, userId);
          return searchDirectory(db, query, limit);
        },
        (rows) => JSON.stringify(rows, null, 2),
      ),
  );

  return server;
}
