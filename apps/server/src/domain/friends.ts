import { and, eq, or, gt, desc, sql, inArray } from "drizzle-orm";
import { accounts, contacts, friendRequests, type Db } from "@2088/db";
import { ulid } from "ulid";
import { DomainError } from "./errors.js";
import { normalizeNumber } from "./numbers.js";

const FRIEND_REQUESTS_PER_DAY = 50;
const REJECTED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pairKey(a: bigint, b: bigint): [bigint, bigint] {
  return a < b ? [a, b] : [b, a];
}

export async function areFriends(db: Db, a: bigint, b: bigint): Promise<boolean> {
  const [x, y] = pairKey(a, b);
  const [row] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.aNumber, x), eq(contacts.bNumber, y)))
    .limit(1);
  return !!row;
}

export async function sendFriendRequest(
  db: Db,
  fromNumber: bigint,
  toNumberRaw: string,
  intro: string,
): Promise<string> {
  const toNumber = normalizeNumber(toNumberRaw);
  if (toNumber === null) {
    throw new DomainError(`号码格式不对: ${toNumberRaw} / invalid number format`);
  }
  if (toNumber === fromNumber) {
    throw new DomainError("不能加自己为好友 / cannot friend yourself");
  }
  if (!intro || intro.length > 100) {
    throw new DomainError("验证语必须填写且不超过 100 字 / intro is required, max 100 chars");
  }

  const [dest] = await db.select().from(accounts).where(eq(accounts.number, toNumber)).limit(1);
  if (!dest || dest.status !== "active") {
    throw new DomainError(`找不到这个 2088 号或已停用: ${toNumber} / number not found or suspended`);
  }

  if (await areFriends(db, fromNumber, toNumber)) {
    throw new DomainError("你们已经是好友了 / already friends");
  }

  const [pending] = await db
    .select()
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.fromNumber, fromNumber),
        eq(friendRequests.toNumber, toNumber),
        eq(friendRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (pending) {
    throw new DomainError("已经有一个待处理的好友申请了 / a pending request already exists");
  }

  const [rejected] = await db
    .select()
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.fromNumber, fromNumber),
        eq(friendRequests.toNumber, toNumber),
        eq(friendRequests.status, "rejected"),
        gt(friendRequests.respondedAt, new Date(Date.now() - REJECTED_COOLDOWN_MS)),
      ),
    )
    .limit(1);
  if (rejected) {
    throw new DomainError("对方最近拒绝过你的申请，7 天内不能再次申请 / recently rejected, wait 7 days before retrying");
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(friendRequests)
    .where(
      and(eq(friendRequests.fromNumber, fromNumber), gt(friendRequests.createdAt, new Date(Date.now() - DAY_MS))),
    );
  if (count >= FRIEND_REQUESTS_PER_DAY) {
    throw new DomainError("今天发出的好友申请太多了，请明天再试 / daily friend request limit reached, try again tomorrow");
  }

  const id = ulid();
  await db.insert(friendRequests).values({ id, fromNumber, toNumber, intro });
  return id;
}

export type FriendRequestDirection = "received" | "sent";

export async function listFriendRequests(
  db: Db,
  myNumber: bigint,
  direction: FriendRequestDirection = "received",
  status = "pending",
) {
  const myCol = direction === "sent" ? friendRequests.fromNumber : friendRequests.toNumber;
  const otherCol = direction === "sent" ? friendRequests.toNumber : friendRequests.fromNumber;

  const conditions = [eq(myCol, myNumber)];
  if (status !== "all") conditions.push(eq(friendRequests.status, status));

  const rows = await db
    .select({
      id: friendRequests.id,
      otherNumber: otherCol,
      otherNickname: accounts.nickname,
      intro: friendRequests.intro,
      status: friendRequests.status,
      createdAt: friendRequests.createdAt,
    })
    .from(friendRequests)
    .innerJoin(accounts, eq(accounts.number, otherCol))
    .where(and(...conditions))
    .orderBy(desc(friendRequests.createdAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    number: r.otherNumber.toString(),
    nickname: r.otherNickname,
    intro: r.intro,
    status: r.status,
    createdAt: r.createdAt,
  }));
}

export async function respondFriendRequest(
  db: Db,
  myNumber: bigint,
  requestId: string,
  action: "accept" | "reject",
): Promise<void> {
  const [row] = await db.select().from(friendRequests).where(eq(friendRequests.id, requestId)).limit(1);
  if (!row) throw new DomainError("找不到这个好友申请 / friend request not found");
  if (row.toNumber !== myNumber) {
    throw new DomainError("这不是发给你的好友申请 / this request is not addressed to you");
  }
  if (row.status !== "pending") {
    throw new DomainError("这个申请已经处理过了 / this request has already been handled");
  }

  const newStatus = action === "accept" ? "accepted" : "rejected";
  await db
    .update(friendRequests)
    .set({ status: newStatus, respondedAt: new Date() })
    .where(eq(friendRequests.id, requestId));

  if (action === "accept") {
    const [a, b] = pairKey(row.fromNumber, row.toNumber);
    await db.insert(contacts).values({ aNumber: a, bNumber: b }).onConflictDoNothing();
  }
}

export async function listContacts(db: Db, myNumber: bigint, limit = 50) {
  const rows = await db
    .select({
      number: sql<string>`(case when ${contacts.aNumber} = ${myNumber} then ${contacts.bNumber} else ${contacts.aNumber} end)::text`,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .where(or(eq(contacts.aNumber, myNumber), eq(contacts.bNumber, myNumber)))
    .orderBy(desc(contacts.createdAt))
    .limit(limit);

  const numbers = rows.map((r) => BigInt(r.number));
  const nicknameMap = new Map<string, string>();
  if (numbers.length > 0) {
    const accts = await db
      .select({ number: accounts.number, nickname: accounts.nickname })
      .from(accounts)
      .where(inArray(accounts.number, numbers));
    for (const a of accts) nicknameMap.set(a.number.toString(), a.nickname);
  }

  return rows.map((r) => ({
    number: r.number,
    nickname: nicknameMap.get(r.number) ?? "",
    since: r.createdAt,
  }));
}
