import { langSwitcher, langSwitcherStyles } from "./lang-switcher.js";
import type { Locale } from "../i18n/index.js";

// Same visual language as apps/web (weid.ai) — light "paper" theme, one
// carrier-blue accent — so auth.weid.ai doesn't feel like a different,
// unstyled site mid-flow. Plain server-rendered HTML with embedded CSS, no
// frontend framework, per CLAUDE.md §7.
const styles = `
  :root {
    --paper: #f6f8fb;
    --card: #ffffff;
    --line: #d8e0ec;
    --ink: #0e1b33;
    --muted: #5a6b85;
    --accent: #2458e6;
    --accent-soft: #e7eeff;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
  }
  .wrap {
    max-width: 480px;
    margin: 0 auto;
    padding: 1.5rem 1.5rem 4rem;
  }
  h1 { font-size: 1.6rem; font-weight: 700; margin: 0 0 1.25rem; letter-spacing: -0.01em; }
  h2 { font-size: 0.95rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; margin: 1.75rem 0 0.6rem; }
  p { color: var(--muted); }
  a { color: var(--accent); }
  strong { color: var(--ink); }
  code {
    background: var(--accent-soft);
    border-radius: 6px;
    padding: 0.15em 0.5em;
    color: var(--accent);
    word-break: break-all;
  }
  form {
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }
  input {
    background: var(--paper);
    border: 1.5px solid var(--line);
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
    color: var(--ink);
    font-size: 1rem;
  }
  input::placeholder { color: var(--muted); }
  button {
    background: var(--accent);
    border: none;
    border-radius: 8px;
    padding: 0.65rem 1rem;
    color: #fff;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
  }
  button:hover { filter: brightness(1.08); }
  img { border-radius: 8px; }
  ${langSwitcherStyles}
`;

// `pathWithQuery` (used for the switcher's links) must be a GET-able path —
// omit it (pass null) on pages that are themselves a POST result with no
// safe "reload in another language" equivalent (e.g. the one-time TOTP
// secret page: re-GETing its URL isn't a route, and there's no way to
// re-trigger the POST that generated it without minting a second identity).
export function pageShell(title: string, pathWithQuery: string | null, locale: Locale, body: string): string {
  const switcher = pathWithQuery ? langSwitcher(pathWithQuery, locale) : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${styles}</style></head>
<body><div class="wrap">${switcher}${body}</div></body></html>`;
}
