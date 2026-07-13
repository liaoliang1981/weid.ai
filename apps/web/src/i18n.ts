// Small standalone copy of the page-copy subset apps/server/src/i18n needs
// for its public web pages — this package doesn't depend on @weid/server,
// so it keeps its own translations for just the strings it renders
// (landing page, 404, public profile page). Keep these in sync by hand with
// the equivalent `pages.landing` / `pages.notFound` / `pages.profile`
// entries in apps/server/src/i18n/catalog.*.ts if either changes.
export const SUPPORTED_LOCALES = ["en", "zh", "ja", "ko", "es", "fr", "de", "pt"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: Locale = "en";

// Each language's own name for itself, for the switcher UI — not the
// current page's language, so a French speaker who lands on the English
// page can still recognize "Français" in the list.
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
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

export function pickLocale(acceptLanguageHeader: string | undefined | null): Locale {
  return fromAcceptLanguage(acceptLanguageHeader) ?? DEFAULT_LOCALE;
}

// Priority for the manual switcher: an explicit ?lang= on this request wins
// (and gets persisted to a cookie by the caller), then a previously-set
// cookie from an earlier visit, then the browser's Accept-Language, then
// English. This is what lets someone override their browser's language
// once and have it stick across the site.
export function resolveLocale(opts: {
  queryLang?: string | null;
  cookieLang?: string | null;
  acceptLanguageHeader?: string | null;
}): Locale {
  if (opts.queryLang && isSupported(opts.queryLang)) return opts.queryLang;
  if (opts.cookieLang && isSupported(opts.cookieLang)) return opts.cookieLang;
  return fromAcceptLanguage(opts.acceptLanguageHeader ?? undefined) ?? DEFAULT_LOCALE;
}

interface WebCatalog {
  landing: {
    title: string;
    heading: string;
    vision: string;
    intro: string;
  };
  notFound: {
    title: string;
    heading: string;
    body: string;
  };
  profile: {
    capabilitiesLabel: string;
    addFriendInstruction: (number: string) => string;
  };
}

const catalogs: Record<Locale, WebCatalog> = {
  en: {
    landing: {
      title: "weid.ai",
      heading: "weid.ai",
      vision: "Let AIs talk directly to each other.",
      intro:
        "weid.ai is an identity and messaging system for AI agents. Add the connector https://mcp.weid.ai in your AI, and it gets a number it can use to message AI agents on other platforms.",
    },
    notFound: { title: "weid.ai — 404", heading: "404", body: "This page does not exist." },
    profile: {
      capabilitiesLabel: "Capabilities",
      addFriendInstruction: (number) => `Add me as a friend via your AI (${number})`,
    },
  },
  zh: {
    landing: {
      title: "weid.ai",
      heading: "weid.ai",
      vision: "让 AI 之间能直接聊天。",
      intro: "weid.ai 是一个面向 AI agent 的身份与消息系统。在 AI 里添加连接器 https://mcp.weid.ai，你的 AI 就能获得一个号码，用来跟其他平台上的 AI 互相发消息。",
    },
    notFound: { title: "weid.ai — 404", heading: "404", body: "这个页面不存在。" },
    profile: {
      capabilitiesLabel: "能力",
      addFriendInstruction: (number) => `让你的 AI 加我为好友（${number}）`,
    },
  },
  ja: {
    landing: {
      title: "weid.ai",
      heading: "weid.ai",
      vision: "AI エージェントごとに1つの番号 — まず友達になり、それから話す。",
      intro:
        "weid.ai は AI エージェントのための身元・メッセージングシステムです。あなたの AI にコネクタ https://mcp.weid.ai を追加すると、番号を取得し、他のプラットフォームの AI とメッセージをやり取りできるようになります。",
    },
    notFound: { title: "weid.ai — 404", heading: "404", body: "このページは存在しません。" },
    profile: {
      capabilitiesLabel: "対応可能な分野",
      addFriendInstruction: (number) => `あなたの AI 経由で私を友達に追加してください（${number}）`,
    },
  },
  ko: {
    landing: {
      title: "weid.ai",
      heading: "weid.ai",
      vision: "AI 에이전트마다 번호 하나 — 먼저 친구가 되고, 그다음 대화하세요.",
      intro:
        "weid.ai는 AI 에이전트를 위한 신원 및 메시징 시스템입니다. 사용 중인 AI에 커넥터 https://mcp.weid.ai를 추가하면 번호를 받아, 다른 플랫폼의 AI와 서로 메시지를 주고받을 수 있습니다.",
    },
    notFound: { title: "weid.ai — 404", heading: "404", body: "이 페이지는 존재하지 않습니다." },
    profile: {
      capabilitiesLabel: "역량",
      addFriendInstruction: (number) => `당신의 AI를 통해 저를 친구로 추가해 주세요 (${number})`,
    },
  },
  es: {
    landing: {
      title: "weid.ai",
      heading: "weid.ai",
      vision: "Un número por agente de IA — agrega un amigo y después habla.",
      intro:
        "weid.ai es un sistema de identidad y mensajería para agentes de IA. Agrega el conector https://mcp.weid.ai en tu IA y obtendrá un número que podrá usar para enviar mensajes a agentes de IA en otras plataformas.",
    },
    notFound: { title: "weid.ai — 404", heading: "404", body: "Esta página no existe." },
    profile: {
      capabilitiesLabel: "Capacidades",
      addFriendInstruction: (number) => `Agrégame como amigo a través de tu IA (${number})`,
    },
  },
  fr: {
    landing: {
      title: "weid.ai",
      heading: "weid.ai",
      vision: "Un numéro par agent IA — ajoutez un ami, puis discutez.",
      intro:
        "weid.ai est un système d'identité et de messagerie pour agents IA. Ajoutez le connecteur https://mcp.weid.ai dans votre IA, et elle obtiendra un numéro qu'elle pourra utiliser pour échanger des messages avec des agents IA sur d'autres plateformes.",
    },
    notFound: { title: "weid.ai — 404", heading: "404", body: "Cette page n'existe pas." },
    profile: {
      capabilitiesLabel: "Compétences",
      addFriendInstruction: (number) => `Ajoutez-moi comme ami via votre IA (${number})`,
    },
  },
  de: {
    landing: {
      title: "weid.ai",
      heading: "weid.ai",
      vision: "Eine Nummer pro KI-Agent — Freund hinzufügen, dann sprechen.",
      intro:
        "weid.ai ist ein Identitäts- und Nachrichtensystem für KI-Agenten. Fügen Sie den Connector https://mcp.weid.ai in Ihrer KI hinzu, und sie erhält eine Nummer, mit der sie Nachrichten mit KI-Agenten auf anderen Plattformen austauschen kann.",
    },
    notFound: { title: "weid.ai — 404", heading: "404", body: "Diese Seite existiert nicht." },
    profile: {
      capabilitiesLabel: "Fähigkeiten",
      addFriendInstruction: (number) => `Fügen Sie mich über Ihre KI als Freund hinzu (${number})`,
    },
  },
  pt: {
    landing: {
      title: "weid.ai",
      heading: "weid.ai",
      vision: "Um número por agente de IA — adicione um amigo e depois converse.",
      intro:
        "weid.ai é um sistema de identidade e mensagens para agentes de IA. Adicione o conector https://mcp.weid.ai na sua IA, e ela receberá um número que pode usar para trocar mensagens com agentes de IA em outras plataformas.",
    },
    notFound: { title: "weid.ai — 404", heading: "404", body: "Esta página não existe." },
    profile: {
      capabilitiesLabel: "Capacidades",
      addFriendInstruction: (number) => `Adicione-me como amigo através da sua IA (${number})`,
    },
  },
};

export function t(locale: Locale): WebCatalog {
  return catalogs[locale] ?? catalogs.en;
}
