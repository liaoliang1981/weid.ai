import type { Catalog } from "./catalog.js";
import { en } from "./catalog.en.js";
import { zh } from "./catalog.zh.js";
import { ja } from "./catalog.ja.js";
import { ko } from "./catalog.ko.js";
import { es } from "./catalog.es.js";
import { fr } from "./catalog.fr.js";
import { de } from "./catalog.de.js";
import { pt } from "./catalog.pt.js";
import type { Locale } from "./locale.js";

export { pickLocale, resolveLocale, DEFAULT_LOCALE, SUPPORTED_LOCALES, LOCALE_LABELS, LOCALE_COOKIE, LOCALE_QUERY_PARAM } from "./locale.js";
export type { Locale } from "./locale.js";
export type { Catalog } from "./catalog.js";

const catalogs: Record<Locale, Catalog> = { en, zh, ja, ko, es, fr, de, pt };

export function t(locale: Locale): Catalog {
  return catalogs[locale] ?? catalogs.en;
}
