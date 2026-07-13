export const SUPPORTED_LOCALES = ["en", "zh", "ja", "ko", "es", "fr", "de", "pt", "th"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

// Each language's own name for itself, for the switcher UI.
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  th: "ไทย",
};

export const LOCALE_COOKIE = "weid_lang";
export const LOCALE_QUERY_PARAM = "lang";

function isSupported(tag: string): tag is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(tag);
}

function fromAcceptLanguage(acceptLanguageHeader: string | undefined | null): Locale | null {
  if (!acceptLanguageHeader) return null;

  const candidates = acceptLanguageHeader
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isNaN(q) ? 1 : q };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of candidates) {
    const primary = tag.split("-")[0];
    if (isSupported(primary)) return primary;
  }
  return null;
}

// Parses a standard Accept-Language header ("zh-CN,zh;q=0.9,en;q=0.8") and
// picks the highest-weighted tag we have a translation for, matching on the
// primary subtag ("zh-CN" -> "zh"). Falls back to English.
export function pickLocale(acceptLanguageHeader: string | undefined | null): Locale {
  return fromAcceptLanguage(acceptLanguageHeader) ?? DEFAULT_LOCALE;
}

// Priority for the manual switcher on auth.weid.ai's pages: an explicit
// ?lang= on this request wins (persisted to a cookie by the caller), then a
// previously-set cookie, then the browser's Accept-Language, then English.
// Whatever this resolves to at registration time is also what gets stored
// as the account's permanent MCP-tool language (see domain/identity.ts) —
// so if someone manually switches the page before registering, that choice
// sticks for their AI's tool text too, not just this page.
export function resolveLocale(opts: {
  queryLang?: string | null;
  cookieLang?: string | null;
  acceptLanguageHeader?: string | null;
}): Locale {
  if (opts.queryLang && isSupported(opts.queryLang)) return opts.queryLang;
  if (opts.cookieLang && isSupported(opts.cookieLang)) return opts.cookieLang;
  return fromAcceptLanguage(opts.acceptLanguageHeader ?? undefined) ?? DEFAULT_LOCALE;
}
