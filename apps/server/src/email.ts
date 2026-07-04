import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

/**
 * Sends the magic-link email. Without RESEND_API_KEY configured (local dev),
 * we log the link to the server console instead of failing — callers decide
 * whether to also echo the link back in the API response for dev testing.
 */
export async function sendMagicLink(email: string, url: string): Promise<void> {
  if (!resend) {
    console.log(`[dev] magic link for ${email}: ${url}`);
    return;
  }

  await resend.emails.send({
    from: "2088.ai <auth@2088.ai>",
    to: email,
    subject: "登录 2088.ai / Sign in to 2088.ai",
    html: `<p>点击下面的链接登录 2088.ai（15 分钟内有效）：</p><p><a href="${url}">${url}</a></p><p>Click the link above to sign in to 2088.ai (valid for 15 minutes).</p>`,
  });
}
