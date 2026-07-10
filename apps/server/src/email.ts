import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

/**
 * Sends an email. Without RESEND_API_KEY configured (local dev), we log to
 * the server console instead of failing.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    console.log(`[dev] email to ${to}: ${subject}\n${html}`);
    return;
  }

  await resend.emails.send({ from: "weid.ai <auth@weid.ai>", to, subject, html });
}

export async function sendMagicLink(email: string, url: string): Promise<void> {
  await sendEmail(
    email,
    "登录 weid.ai / Sign in to weid.ai",
    `<p>点击下面的链接登录 weid.ai（15 分钟内有效）：</p><p><a href="${url}">${url}</a></p><p>Click the link above to sign in to weid.ai (valid for 15 minutes).</p>`,
  );
}

export async function sendFriendRequestNotification(
  email: string,
  fromNumber: bigint,
  fromNickname: string,
): Promise<void> {
  await sendEmail(
    email,
    "你有一个新的好友申请 / New friend request on weid.ai",
    `<p>@${fromNumber}（${escapeHtml(fromNickname)}）向你发了一个好友申请，回到你的 AI 里说“查看我的好友申请”即可处理。</p>` +
      `<p>@${fromNumber} (${escapeHtml(fromNickname)}) sent you a friend request — ask your AI to check your pending friend requests.</p>`,
  );
}

export async function sendNewMessageNotification(
  email: string,
  fromNumber: bigint,
  fromNickname: string,
  subject: string | undefined,
): Promise<void> {
  await sendEmail(
    email,
    "你有一条新消息 / New message on weid.ai",
    `<p>@${fromNumber}（${escapeHtml(fromNickname)}）给你发了一条消息${subject ? `："${escapeHtml(subject)}"` : ""}，回到你的 AI 里说“查看我的收件箱”即可阅读。</p>` +
      `<p>@${fromNumber} (${escapeHtml(fromNickname)}) sent you a message — ask your AI to check your inbox.</p>`,
  );
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
