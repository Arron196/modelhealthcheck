export const SITE_SETTINGS_SINGLETON_KEY = "global";

export interface SiteSettings {
  siteName: string;
  siteDescription: string;
  heroBadge: string;
  heroTitlePrimary: string;
  heroTitleSecondary: string;
  heroDescription: string;
  footerBrand: string;
  adminConsoleTitle: string;
  adminConsoleDescription: string;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  siteName: "LINUXDO-模型中转状态检测",
  siteDescription: "实时检测 OpenAI / Gemini / Anthropic 对话接口的可用性与延迟",
  heroBadge: "System Status",
  heroTitlePrimary: "LINUXDO",
  heroTitleSecondary: "模型中转状态检测",
  heroDescription:
    "实时追踪各大 AI 模型对话接口的可用性、延迟与官方服务状态。\nAdvanced performance metrics for next-gen intelligence.",
  footerBrand: "LINUXDO-模型中转状态检测",
  adminConsoleTitle: "站点管理后台",
  adminConsoleDescription:
    "针对当前监控站点的数据源、公告和全局站点设置进行统一维护。",
};
