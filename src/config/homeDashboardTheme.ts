/** Visual theme + motion config for premium living dashboard cards. */
export type HomeTileLayout = "heroPrimary" | "heroSecondary" | "scene" | "featured";

export type HomeDashboardTheme = {
  layout: HomeTileLayout;
  gradient: string;
  glow: string;
  shadow: string;
  subtitleKey: string;
  lottieId: string;
  artClass: string;
  ctaKey?: string;
};

const THEME: Record<string, HomeDashboardTheme> = {
  sell: {
    layout: "heroPrimary",
    gradient: "from-waka-500 via-waka-600 to-waka-700",
    glow: "rgba(251,146,60,0.35)",
    shadow: "shadow-[0_16px_48px_rgba(234,88,12,0.38)]",
    subtitleKey: "desktopHomeTileSellSub",
    lottieId: "sell",
    artClass: "home-art-sell",
    ctaKey: "desktopHomeCtaNewSale",
  },
  profit: {
    layout: "heroSecondary",
    gradient: "from-emerald-500 via-emerald-600 to-teal-800",
    glow: "rgba(52,211,153,0.32)",
    shadow: "shadow-[0_16px_48px_rgba(5,150,105,0.35)]",
    subtitleKey: "desktopHomeTileProfitSub",
    lottieId: "profit",
    artClass: "home-art-profit",
  },
  inventory: {
    layout: "scene",
    gradient: "from-fuchsia-500 via-purple-600 to-violet-900",
    glow: "rgba(192,132,252,0.28)",
    shadow: "shadow-[0_12px_36px_rgba(124,58,237,0.32)]",
    subtitleKey: "desktopHomeTileInventorySub",
    lottieId: "inventory",
    artClass: "home-art-inventory",
  },
  cash: {
    layout: "scene",
    gradient: "from-sky-400 via-blue-600 to-blue-900",
    glow: "rgba(56,189,248,0.28)",
    shadow: "shadow-[0_12px_36px_rgba(2,132,199,0.32)]",
    subtitleKey: "desktopHomeTileCashSub",
    lottieId: "cash",
    artClass: "home-art-cash",
  },
  salesHistory: {
    layout: "scene",
    gradient: "from-teal-500 via-cyan-600 to-emerald-900",
    glow: "rgba(45,212,191,0.28)",
    shadow: "shadow-[0_12px_36px_rgba(13,148,136,0.3)]",
    subtitleKey: "desktopHomeTileSalesHistorySub",
    lottieId: "salesHistory",
    artClass: "home-art-salesHistory",
  },
  debts: {
    layout: "scene",
    gradient: "from-violet-500 via-purple-700 to-indigo-900",
    glow: "rgba(167,139,250,0.28)",
    shadow: "shadow-[0_12px_36px_rgba(109,40,217,0.3)]",
    subtitleKey: "desktopHomeTileDebtsSub",
    lottieId: "debts",
    artClass: "home-art-debts",
  },
  investigation: {
    layout: "scene",
    gradient: "from-rose-400 via-red-500 to-rose-900",
    glow: "rgba(251,113,133,0.28)",
    shadow: "shadow-[0_12px_36px_rgba(225,29,72,0.3)]",
    subtitleKey: "desktopHomeTileInvestigationSub",
    lottieId: "investigation",
    artClass: "home-art-investigation",
  },
  shop: {
    layout: "scene",
    gradient: "from-amber-600 via-waka-700 to-amber-900",
    glow: "rgba(251,191,36,0.25)",
    shadow: "shadow-[0_12px_36px_rgba(180,83,9,0.3)]",
    subtitleKey: "desktopHomeTileShopSub",
    lottieId: "shop",
    artClass: "home-art-shop",
  },
  settings: {
    layout: "scene",
    gradient: "from-waka-400 via-waka-600 to-waka-900",
    glow: "rgba(251,146,60,0.25)",
    shadow: "shadow-[0_12px_36px_rgba(234,88,12,0.28)]",
    subtitleKey: "desktopHomeTileSettingsSub",
    lottieId: "settings",
    artClass: "home-art-settings",
  },
  reports: {
    layout: "featured",
    gradient: "from-teal-600 via-emerald-700 to-teal-950",
    glow: "rgba(45,212,191,0.3)",
    shadow: "shadow-[0_20px_56px_rgba(13,148,136,0.38)]",
    subtitleKey: "desktopHomeTileReportsSub",
    lottieId: "reports",
    artClass: "home-art-reports",
    ctaKey: "desktopHomeCtaViewReports",
  },
  agent: {
    layout: "scene",
    gradient: "from-amber-500 via-waka-600 to-waka-800",
    glow: "rgba(251,191,36,0.28)",
    shadow: "shadow-[0_12px_36px_rgba(234,88,12,0.3)]",
    subtitleKey: "desktopHomeTileAgentSub",
    lottieId: "agent",
    artClass: "home-art-agent",
  },
  cashPosition: {
    layout: "scene",
    gradient: "from-emerald-500 via-teal-600 to-teal-900",
    glow: "rgba(52,211,153,0.28)",
    shadow: "shadow-[0_12px_36px_rgba(13,148,136,0.32)]",
    subtitleKey: "desktopHomeTileCashPositionSub",
    lottieId: "cashPosition",
    artClass: "home-art-cashPosition",
  },
  commandCenter: {
    layout: "scene",
    gradient: "from-indigo-500 via-blue-600 to-violet-900",
    glow: "rgba(99,102,241,0.28)",
    shadow: "shadow-[0_12px_36px_rgba(79,70,229,0.32)]",
    subtitleKey: "desktopHomeTileCommandCenterSub",
    lottieId: "commandCenter",
    artClass: "home-art-commandCenter",
  },
};

export function homeDashboardTheme(tileId: string): HomeDashboardTheme {
  return (
    THEME[tileId] ?? {
      layout: "scene",
      gradient: "from-stone-600 to-stone-800",
      glow: "rgba(255,255,255,0.15)",
      shadow: "shadow-lg",
      subtitleKey: "desktopHomeTileSellSub",
      lottieId: tileId,
      artClass: "",
    }
  );
}
