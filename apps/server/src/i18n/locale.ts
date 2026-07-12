export const SUPPORTED_LOCALES = ["en", "zh", "ja", "ko", "es", "fr", "de", "pt"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

function isSupported(tag: string): tag is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(tag);
}

// Parses a standard Accept-Language header ("zh-CN,zh;q=0.9,en;q=0.8") and
// picks the highest-weighted tag we have a translation for, matching on the
// primary subtag ("zh-CN" -> "zh"). Falls back to English.
export function pickLocale(acceptLanguageHeader: string | undefined | null): Locale {
  if (!acceptLanguageHeader) return DEFAULT_LOCALE;

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
  return DEFAULT_LOCALE;
}
