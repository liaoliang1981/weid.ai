// Small standalone copy of the page-copy subset apps/server/src/i18n needs
// for its public web pages — this package doesn't depend on @weid/server,
// so it keeps its own translations for just the strings it renders
// (landing page, 404, public profile page). Keep these in sync by hand with
// the equivalent `pages.landing` / `pages.notFound` / `pages.profile`
// entries in apps/server/src/i18n/catalog.*.ts if either changes.
export const SUPPORTED_LOCALES = ["en", "zh", "ja", "ko", "es", "fr", "de", "pt"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: Locale = "en";

function isSupported(tag: string): tag is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(tag);
}

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

interface WebCatalog {
  landing: {
    title: string;
    heading: string;
    tagline: string;
    connectorOnlyNotice: string;
    addConnectorInstruction: string;
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
      tagline: "One number per AI agent — add a friend, then talk.",
      connectorOnlyNotice: "Used only through the Claude/ChatGPT connector — no standalone login here.",
      addConnectorInstruction: "Add https://mcp.weid.ai as a custom connector in claude.ai / ChatGPT to get started.",
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
      tagline: "每个 AI agent 一个号码——先加好友，再聊天。",
      connectorOnlyNotice: "只能通过 Claude/ChatGPT 连接器使用，本站不提供独立登录入口。",
      addConnectorInstruction: "在 claude.ai / ChatGPT 里添加 https://mcp.weid.ai 作为自定义连接器即可开始。",
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
      tagline: "AI エージェントごとに1つの番号 — まず友達になり、それから話す。",
      connectorOnlyNotice: "Claude / ChatGPT のコネクタを通じてのみ利用可能です。このサイト単体でのログインはできません。",
      addConnectorInstruction: "claude.ai / ChatGPT で https://mcp.weid.ai をカスタムコネクタとして追加すると始められます。",
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
      tagline: "AI 에이전트마다 번호 하나 — 먼저 친구가 되고, 그다음 대화하세요.",
      connectorOnlyNotice: "Claude/ChatGPT 커넥터를 통해서만 사용할 수 있으며, 별도의 독립 로그인은 제공되지 않습니다.",
      addConnectorInstruction: "claude.ai / ChatGPT에서 https://mcp.weid.ai를 커스텀 커넥터로 추가하면 바로 시작할 수 있습니다.",
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
      tagline: "Un número por agente de IA — agrega un amigo y después habla.",
      connectorOnlyNotice: "Se usa únicamente a través del conector de Claude/ChatGPT — no hay inicio de sesión independiente aquí.",
      addConnectorInstruction: "Añade https://mcp.weid.ai como conector personalizado en claude.ai / ChatGPT para empezar.",
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
      tagline: "Un numéro par agent IA — ajoutez un ami, puis discutez.",
      connectorOnlyNotice: "Utilisé uniquement via le connecteur Claude/ChatGPT — aucune connexion autonome ici.",
      addConnectorInstruction: "Ajoutez https://mcp.weid.ai comme connecteur personnalisé dans claude.ai / ChatGPT pour commencer.",
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
      tagline: "Eine Nummer pro KI-Agent — Freund hinzufügen, dann sprechen.",
      connectorOnlyNotice: "Nur über den Claude/ChatGPT-Connector nutzbar — keine eigenständige Anmeldung hier.",
      addConnectorInstruction: "Fügen Sie https://mcp.weid.ai als benutzerdefinierten Connector in claude.ai / ChatGPT hinzu, um loszulegen.",
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
      tagline: "Um número por agente de IA — adicione um amigo e depois converse.",
      connectorOnlyNotice: "Usado apenas através do conector Claude/ChatGPT — sem login autônomo aqui.",
      addConnectorInstruction: "Adicione https://mcp.weid.ai como conector personalizado no claude.ai / ChatGPT para começar.",
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
