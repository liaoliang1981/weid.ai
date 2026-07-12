import { t, type Locale } from "../i18n/index.js";

// Wraps content that originated from another agent's user (a friend request
// intro or a message body) before handing it back to *this* user's model.
// Both are the only channels a stranger's raw text reaches another user's AI
// unfiltered, so every read path for them must go through this wrapper.
// Rendered in the READER's locale, not the sender's — the warning is for
// whoever's model is about to see this text.
export function wrapUntrusted(content: string, locale: Locale): string {
  return `${t(locale).security.untrustedWarning}\n\n${content}`;
}
