import "server-only";

import type {SiteSettingsRow} from "@/lib/types/database";
import {
  DEFAULT_SITE_SETTINGS,
  SITE_SETTINGS_SINGLETON_KEY,
  type SiteSettings,
} from "@/lib/types/site-settings";
import {getControlPlaneStorage, getStorageCapabilities} from "@/lib/storage/resolver";
import {getErrorMessage, logError} from "@/lib/utils";

interface SiteSettingsState {
  settings: SiteSettings;
  source: "database" | "fallback";
  warning: string | null;
}

const SITE_SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;

let cache: {
  value: SiteSettingsState;
  lastFetchedAt: number;
} = {
  value: {
    settings: DEFAULT_SITE_SETTINGS,
    source: "fallback",
    warning: null,
  },
  lastFetchedAt: 0,
};

function normalizeValue(value: string | null | undefined, fallback: string): string {
  const nextValue = value?.trim();
  return nextValue ? nextValue : fallback;
}

function normalizeSiteSettings(row?: Partial<SiteSettingsRow> | null): SiteSettings {
  return {
    siteName: normalizeValue(row?.site_name, DEFAULT_SITE_SETTINGS.siteName),
    siteDescription: normalizeValue(row?.site_description, DEFAULT_SITE_SETTINGS.siteDescription),
    heroBadge: normalizeValue(row?.hero_badge, DEFAULT_SITE_SETTINGS.heroBadge),
    heroTitlePrimary: normalizeValue(
      row?.hero_title_primary,
      DEFAULT_SITE_SETTINGS.heroTitlePrimary
    ),
    heroTitleSecondary: normalizeValue(
      row?.hero_title_secondary,
      DEFAULT_SITE_SETTINGS.heroTitleSecondary
    ),
    heroDescription: normalizeValue(
      row?.hero_description,
      DEFAULT_SITE_SETTINGS.heroDescription
    ),
    footerBrand: normalizeValue(row?.footer_brand, DEFAULT_SITE_SETTINGS.footerBrand),
    adminConsoleTitle: normalizeValue(
      row?.admin_console_title,
      DEFAULT_SITE_SETTINGS.adminConsoleTitle
    ),
    adminConsoleDescription: normalizeValue(
      row?.admin_console_description,
      DEFAULT_SITE_SETTINGS.adminConsoleDescription
    ),
  };
}

function getSettingsFallbackState(message: string | null = null): SiteSettingsState {
  return {
    settings: DEFAULT_SITE_SETTINGS,
    source: "fallback",
    warning: message,
  };
}

function isMissingRelationError(message: string): boolean {
  return /relation|does not exist|invalid schema|column/i.test(message);
}

export function invalidateSiteSettingsCache(): void {
  cache = {
    value: getSettingsFallbackState(),
    lastFetchedAt: 0,
  };
}

export async function loadSiteSettingsState(): Promise<SiteSettingsState> {
  if (Date.now() - cache.lastFetchedAt < SITE_SETTINGS_CACHE_TTL_MS) {
    return cache.value;
  }

  try {
    const storage = await getControlPlaneStorage();
    const data = await storage.siteSettings.getSingleton(SITE_SETTINGS_SINGLETON_KEY);

    const nextValue: SiteSettingsState = data
      ? {
          settings: normalizeSiteSettings(data as SiteSettingsRow),
          source: "database",
          warning: null,
        }
      : getSettingsFallbackState("站点设置尚未初始化，当前使用默认品牌配置。保存一次设置后即可切换到后台配置。");

    cache = {
      value: nextValue,
      lastFetchedAt: Date.now(),
    };
    return nextValue;
  } catch (error) {
    logError("load site settings failed", error);
    const message = getErrorMessage(error);
    const capabilities = getStorageCapabilities();
    const fallbackState = getSettingsFallbackState(
      isMissingRelationError(message)
        ? capabilities.runtimeMigrations
          ? "站点设置存储尚未就绪，当前使用默认品牌配置。请先执行 Supabase 自动迁移或手动补齐最新结构。"
          : "站点设置存储尚未初始化，当前使用默认品牌配置。所选数据库后端会在首次写入时自动创建控制面表结构。"
        : `读取站点设置失败，当前使用默认配置：${message}`
    );
    cache = {
      value: fallbackState,
      lastFetchedAt: Date.now(),
    };
    return fallbackState;
  }
}

export async function loadSiteSettings(): Promise<SiteSettings> {
  return (await loadSiteSettingsState()).settings;
}
