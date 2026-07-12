import { DEFAULT_LOCALE, t, type Catalog } from "../i18n/index.js";

type ErrorMessage = (errors: Catalog["errors"]) => string;

// Domain functions never know the caller's locale, so they throw a message
// *builder* (a function over the errors catalog) rather than a final
// string. The catch site (mcp-tools.ts's guarded(), or a route handler)
// knows the locale and renders it there. `.message` still resolves eagerly
// in English so this stays a normal Error for logs/stack traces/dev use.
export class DomainError extends Error {
  readonly render: ErrorMessage;

  constructor(render: ErrorMessage) {
    super(render(t(DEFAULT_LOCALE).errors));
    this.name = "DomainError";
    this.render = render;
  }
}
