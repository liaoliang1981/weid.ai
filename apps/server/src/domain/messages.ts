import { and, eq, or, gt, lt, desc, sql, inArray } from "drizzle-orm";
import { accounts, messages, type Db } from "@weid/db";
import { ulid } from "ulid";
import { DomainError } from "./errors.js";
import { normalizeNumber } from "./numbers.js";
import { areFriends } from "./friends.js";
import { wrapUntrusted } from "./security.js";
import type { Locale } from "../i18n/index.js";

const MESSAGES_PER_HOUR = 100;
const MESSAGES_PER_DAY = 800;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface MessageBody {
  format: "weid.msg.v1";
  text: string;
  structured?: { intent: string; fields?: Record<string, unknown> };
  sender_model?: string;
  reply_to?: string | null;
}

export async function sendMessage(
  db: Db,
  fromNumber: bigint,
  toNumberRaw: string,
  subject: string | undefined,
  bodyText: string,
  structured?: MessageBody["structured"],
  senderModel?: string,
  replyTo?: string,
): Promise<{ id: string; threadId: string }> {
  const toNumber = normalizeNumber(toNumberRaw);
  if (toNumber === null) {
    throw new DomainError((e) => e.invalidNumberFormat(toNumberRaw));
  }
  if (!bodyText) {
    throw new DomainError((e) => e.messageTextRequired);
  }

  const [dest] = await db.select().from(accounts).where(eq(accounts.number, toNumber)).limit(1);
  if (!dest || dest.status !== "active") {
    throw new DomainError((e) => e.numberNotFoundOrSuspended(toNumber.toString()));
  }

  if (!(await areFriends(db, fromNumber, toNumber))) {
    throw new DomainError((e) => e.notFriendsYet);
  }

  const [{ hourCount }] = await db
    .select({ hourCount: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.fromNumber, fromNumber), gt(messages.createdAt, new Date(Date.now() - HOUR_MS))));
  if (hourCount >= MESSAGES_PER_HOUR) {
    throw new DomainError((e) => e.hourlyLimitReached);
  }
  const [{ dayCount }] = await db
    .select({ dayCount: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.fromNumber, fromNumber), gt(messages.createdAt, new Date(Date.now() - DAY_MS))));
  if (dayCount >= MESSAGES_PER_DAY) {
    throw new DomainError((e) => e.dailyMessageLimitReached);
  }

  let threadId = ulid();
  if (replyTo) {
    const [parent] = await db.select().from(messages).where(eq(messages.id, replyTo)).limit(1);
    if (parent && (parent.fromNumber === fromNumber || parent.toNumber === fromNumber)) {
      threadId = parent.threadId;
    }
  }

  const body: MessageBody = {
    format: "weid.msg.v1",
    text: bodyText,
    structured,
    sender_model: senderModel ?? "unknown",
    reply_to: replyTo ?? null,
  };

  const id = ulid();
  await db.insert(messages).values({ id, fromNumber, toNumber, threadId, subject, body });
  return { id, threadId };
}

export async function checkInbox(
  db: Db,
  myNumber: bigint,
  locale: Locale,
  status = "unread",
  limit = 10,
  cursor?: string,
) {
  const conditions = [eq(messages.toNumber, myNumber)];
  if (status !== "all") conditions.push(eq(messages.status, status));
  if (cursor) conditions.push(lt(messages.id, cursor));

  const rows = await db
    .select({
      id: messages.id,
      fromNumber: messages.fromNumber,
      fromNickname: accounts.nickname,
      subject: messages.subject,
      status: messages.status,
      threadId: messages.threadId,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(accounts, eq(accounts.number, messages.fromNumber))
    .where(and(...conditions))
    .orderBy(desc(messages.id))
    .limit(Math.min(limit, 50));

  return rows.map((r) => ({
    id: r.id,
    threadId: r.threadId,
    from: r.fromNumber.toString(),
    fromNickname: r.fromNickname,
    subject: r.subject ? wrapUntrusted(r.subject, locale) : "",
    status: r.status,
    createdAt: r.createdAt,
  }));
}

function toMessageView(row: typeof messages.$inferSelect, myNumber: bigint, nicknames: Map<bigint, string>, locale: Locale) {
  const body = row.body as MessageBody;
  return {
    id: row.id,
    threadId: row.threadId,
    from: row.fromNumber.toString(),
    fromNickname: nicknames.get(row.fromNumber) ?? null,
    to: row.toNumber.toString(),
    toNickname: nicknames.get(row.toNumber) ?? null,
    direction: row.fromNumber === myNumber ? ("outgoing" as const) : ("incoming" as const),
    subject: row.subject ? wrapUntrusted(row.subject, locale) : "",
    text: wrapUntrusted(body.text, locale),
    structured: body.structured ?? null,
    senderModel: body.sender_model ?? "unknown",
    status: row.status,
    createdAt: row.createdAt,
  };
}

export async function readMessage(
  db: Db,
  myNumber: bigint,
  locale: Locale,
  opts: { messageId?: string; threadId?: string },
) {
  if (!opts.messageId && !opts.threadId) {
    throw new DomainError((e) => e.messageOrThreadIdRequired);
  }

  const rows = opts.messageId
    ? await db.select().from(messages).where(eq(messages.id, opts.messageId)).limit(1)
    : await db
        .select()
        .from(messages)
        .where(eq(messages.threadId, opts.threadId!))
        .orderBy(messages.createdAt);

  const visible = rows.filter((r) => r.fromNumber === myNumber || r.toNumber === myNumber);
  if (visible.length === 0) {
    throw new DomainError((e) => e.messageOrThreadNotFound);
  }

  const unreadIds = visible.filter((r) => r.toNumber === myNumber && r.status === "unread").map((r) => r.id);
  if (unreadIds.length > 0) {
    await db
      .update(messages)
      .set({ status: "read" })
      .where(and(eq(messages.toNumber, myNumber), or(...unreadIds.map((id) => eq(messages.id, id)))));
  }

  const numbers = [...new Set(visible.flatMap((r) => [r.fromNumber, r.toNumber]))];
  const accountRows = await db
    .select({ number: accounts.number, nickname: accounts.nickname })
    .from(accounts)
    .where(inArray(accounts.number, numbers));
  const nicknames = new Map(accountRows.map((a) => [a.number, a.nickname]));

  return visible.map((r) => toMessageView(r, myNumber, nicknames, locale));
}
