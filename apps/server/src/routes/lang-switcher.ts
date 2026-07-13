import { SUPPORTED_LOCALES, LOCALE_LABELS, LOCALE_QUERY_PARAM, type Locale } from "../i18n/index.js";

// Plain links to ?lang=xx, not a <select>/JS toggle — zero JavaScript,
// consistent with apps/web's landing/profile pages. `pathWithQuery` is the
// current request's path plus any existing query string (minus any
// pre-existing ?lang=) — critical on the OAuth chooser page, which carries
// client_id/redirect_uri/code_challenge/etc. in its URL; losing those on a
// language switch would break the in-progress authorization.
export function langSwitcher(pathWithQuery: string, current: Locale): string {
  const [path, existingQuery] = pathWithQuery.split("?");
  const params = new URLSearchParams(existingQuery ?? "");
  const items = SUPPORTED_LOCALES.map((loc) => {
    params.set(LOCALE_QUERY_PARAM, loc);
    const cls = loc === current ? ' class="active"' : "";
    return `<a href="${path}?${params.toString()}"${cls}>${LOCALE_LABELS[loc]}</a>`;
  });
  return `<nav class="lang-switcher">${items.join("")}</nav>`;
}

export const langSwitcherStyles = `
  .lang-switcher {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.6rem;
    margin: 0 0 2rem;
  }
  .lang-switcher a {
    font-size: 0.82rem;
    color: #8b93b0;
    text-decoration: none;
    padding: 0.15rem 0.1rem;
    border-bottom: 2px solid transparent;
  }
  .lang-switcher a:hover {
    color: #e6e9f5;
  }
  .lang-switcher a.active {
    color: #63b3ed;
    border-bottom-color: #63b3ed;
  }
`;
