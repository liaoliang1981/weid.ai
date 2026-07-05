import { eq } from "drizzle-orm";
import { accounts, users, type Db } from "@2088/db";
import { sendFriendRequestNotification, sendNewMessageNotification } from "./email.js";

async function recipientEmail(db: Db, toNumber: bigint): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email, notifyEmail: users.notifyEmail })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(eq(accounts.number, toNumber))
    .limit(1);
  if (!row || !row.notifyEmail) return null;
  return row.email;
}

// Notification failures must never break the underlying tool call that
// triggered them, so every entry point here swallows its own errors.
export async function notifyNewFriendRequest(
  db: Db,
  toNumber: bigint,
  fromNumber: bigint,
  fromNickname: string,
): Promise<void> {
  try {
    const email = await recipientEmail(db, toNumber);
    if (!email) return;
    await sendFriendRequestNotification(email, fromNumber, fromNickname);
  } catch (err) {
    console.error("failed to send friend request notification", err);
  }
}

export async function notifyNewMessage(
  db: Db,
  toNumber: bigint,
  fromNumber: bigint,
  fromNickname: string,
  subject: string | undefined,
): Promise<void> {
  try {
    const email = await recipientEmail(db, toNumber);
    if (!email) return;
    await sendNewMessageNotification(email, fromNumber, fromNickname, subject);
  } catch (err) {
    console.error("failed to send new message notification", err);
  }
}
