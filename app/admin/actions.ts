"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {isRedirectError} from "next/dist/client/components/redirect-error";

import {
  authenticateAdminUser,
  clearAdminSession,
  createInitialAdminUser,
  requireAdminSession,
  verifyTurnstile,
} from "@/lib/admin/auth";
import {runSupabaseAutoFix} from "@/lib/admin/supabase-diagnostics";
import {ADMIN_NOTIFICATION_LEVELS, ADMIN_PROVIDER_TYPES} from "@/lib/admin/data";
import {invalidateStorageDiagnosticsCache} from "@/lib/admin/storage-diagnostics-cache";
import {invalidateDashboardCache} from "@/lib/core/dashboard-data";
import {invalidateConfigCache} from "@/lib/database/config-loader";
import {invalidateGroupInfoCache} from "@/lib/database/group-info";
import {invalidateSiteSettingsCache} from "@/lib/site-settings";
import {getControlPlaneStorage} from "@/lib/storage/resolver";
import {ensureRuntimeMigrations, invalidateRuntimeMigrationCache} from "@/lib/supabase/runtime-migrations";
import {normalizeProviderEndpoint} from "@/lib/providers/endpoint-utils";
import {getErrorMessage, logError} from "@/lib/utils";
import {SITE_SETTINGS_SINGLETON_KEY} from "@/lib/types/site-settings";

type JsonRecord = Record<string, unknown>;

function getText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getOptionalText(formData: FormData, key: string): string | null {
  const value = getText(formData, key);
  return value ? value : null;
}

function getBoolean(formData: FormData, key: string): boolean {
  return formData.get(key) === "on";
}

function parseJsonRecord(formData: FormData, key: string, label: string): JsonRecord | null {
  const raw = getOptionalText(formData, key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} 必须是 JSON 对象`);
    }
    return parsed as JsonRecord;
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : `${label} 不是合法的 JSON 对象`
    );
  }
}

function ensureProviderType(value: string): asserts value is (typeof ADMIN_PROVIDER_TYPES)[number] {
  if (!ADMIN_PROVIDER_TYPES.includes(value as (typeof ADMIN_PROVIDER_TYPES)[number])) {
    throw new Error("不支持的 Provider 类型");
  }
}

function ensureNotificationLevel(
  value: string
): asserts value is (typeof ADMIN_NOTIFICATION_LEVELS)[number] {
  if (
    !ADMIN_NOTIFICATION_LEVELS.includes(
      value as (typeof ADMIN_NOTIFICATION_LEVELS)[number]
    )
  ) {
    throw new Error("不支持的通知级别");
  }
}

function buildRedirectUrl(
  returnTo: string,
  noticeType: "success" | "error",
  message: string
): string {
  const [pathname, search = ""] = returnTo.split("?");
  const params = new URLSearchParams(search);
  params.set("notice", message);
  params.set("noticeType", noticeType);
  return `${pathname}?${params.toString()}`;
}

function revalidateAdminPaths(returnTo: string): void {
  const basePaths = [
    "/",
    "/admin",
    "/admin/configs",
    "/admin/templates",
    "/admin/groups",
    "/admin/notifications",
    "/admin/supabase",
    "/admin/settings",
    returnTo.split("?")[0],
  ];

  for (const path of new Set(basePaths)) {
    revalidatePath(path);
  }
}

function invalidateOperationalCaches(): void {
  invalidateConfigCache();
  invalidateGroupInfoCache();
  invalidateDashboardCache();
  invalidateStorageDiagnosticsCache();
  invalidateSiteSettingsCache();
  invalidateRuntimeMigrationCache();
}

function getPasswordConfirmation(formData: FormData): string {
  const password = getText(formData, "password");
  const confirmPassword = getText(formData, "confirm_password");
  if (!password || !confirmPassword) {
    throw new Error("密码和确认密码不能为空");
  }
  if (password !== confirmPassword) {
    throw new Error("两次输入的密码不一致");
  }
  return password;
}

async function resolveApiKey(formData: FormData, id: string | null): Promise<string> {
  const apiKey = getOptionalText(formData, "api_key");
  if (apiKey) {
    return apiKey;
  }

  if (!id) {
    throw new Error("新增配置时必须填写 API Key");
  }

  const storage = await getControlPlaneStorage();
  const data = await storage.checkConfigs.getById(id);

  if (!data?.api_key) {
    throw new Error("原有配置缺少 API Key，请重新填写");
  }

  return data.api_key;
}

async function handleAction(
  formData: FormData,
  actionName: string,
  successMessage: string,
  operation: () => Promise<void>
): Promise<never> {
  await requireAdminSession();
  const returnTo = getOptionalText(formData, "returnTo") ?? "/admin";

  try {
    await operation();
    invalidateOperationalCaches();
    revalidateAdminPaths(returnTo);
    redirect(buildRedirectUrl(returnTo, "success", successMessage));
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    logError(`admin action failed: ${actionName}`, error);
    const message = error instanceof Error ? error.message : getErrorMessage(error);
    redirect(buildRedirectUrl(returnTo, "error", message));
  }
}

export async function bootstrapAdminAction(formData: FormData): Promise<never> {
  try {
    await verifyTurnstile(formData, "admin_bootstrap");
    await createInitialAdminUser({
      username: getText(formData, "username"),
      password: getPasswordConfirmation(formData),
    });
    revalidateAdminPaths("/admin");
    redirect("/admin");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : getErrorMessage(error);
    redirect(buildRedirectUrl("/admin/login", "error", message));
  }
}

export async function loginAdminAction(formData: FormData): Promise<never> {
  try {
    await verifyTurnstile(formData, "login");
    await authenticateAdminUser({
      username: getText(formData, "username"),
      password: getText(formData, "password"),
    });
    revalidateAdminPaths("/admin");
    redirect("/admin");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : getErrorMessage(error);
    redirect(buildRedirectUrl("/admin/login", "error", message));
  }
}

export async function logoutAdminAction(): Promise<never> {
  await clearAdminSession();
  redirect(buildRedirectUrl("/admin/login", "success", "已退出登录"));
}

export async function runSupabaseAutoFixAction(): Promise<never> {
  await requireAdminSession();

  try {
    const result = await runSupabaseAutoFix();
    const message =
      result.repairedCount > 0
        ? `自动修复完成：${result.repairedItems.join("；")}`
        : "当前没有可自动修复的数据库问题";

    invalidateOperationalCaches();
    revalidateAdminPaths("/admin/storage");
    redirect(buildRedirectUrl("/admin/storage", "success", message));
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    logError("admin action failed: runSupabaseAutoFix", error);
    const message = error instanceof Error ? error.message : getErrorMessage(error);
    redirect(buildRedirectUrl("/admin/storage", "error", message));
  }
}

export async function runSupabaseAutoMigrateAction(): Promise<never> {
  await requireAdminSession();

  try {
    const result = await ensureRuntimeMigrations({force: true});
    const message = result.blockedReason
      ? `自动迁移不可用：${result.blockedReason}`
      : result.appliedCount > 0
        ? `自动迁移完成：${result.appliedItems.join("；")}`
        : "当前没有待执行的自动迁移";

    invalidateOperationalCaches();
    revalidateAdminPaths("/admin/storage");
    redirect(
      buildRedirectUrl(
        "/admin/storage",
        result.blockedReason ? "error" : "success",
        message
      )
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    logError("admin action failed: runSupabaseAutoMigrate", error);
    const message = error instanceof Error ? error.message : getErrorMessage(error);
    redirect(buildRedirectUrl("/admin/storage", "error", message));
  }
}

export async function upsertSiteSettingsAction(formData: FormData): Promise<never> {
  return handleAction(formData, "upsertSiteSettings", "站点设置已保存", async () => {
    const siteName = getText(formData, "site_name");
    const siteDescription = getText(formData, "site_description");
    const heroBadge = getText(formData, "hero_badge");
    const heroTitlePrimary = getText(formData, "hero_title_primary");
    const heroTitleSecondary = getText(formData, "hero_title_secondary");
    const heroDescription = getText(formData, "hero_description");
    const footerBrand = getText(formData, "footer_brand");
    const adminConsoleTitle = getText(formData, "admin_console_title");
    const adminConsoleDescription = getText(formData, "admin_console_description");

    if (
      !siteName ||
      !siteDescription ||
      !heroBadge ||
      !heroTitlePrimary ||
      !heroTitleSecondary ||
      !heroDescription ||
      !footerBrand ||
      !adminConsoleTitle ||
      !adminConsoleDescription
    ) {
      throw new Error("站点设置字段不能为空");
    }

    const storage = await getControlPlaneStorage();
    await storage.siteSettings.upsert({
      singleton_key: SITE_SETTINGS_SINGLETON_KEY,
      site_name: siteName,
      site_description: siteDescription,
      hero_badge: heroBadge,
      hero_title_primary: heroTitlePrimary,
      hero_title_secondary: heroTitleSecondary,
      hero_description: heroDescription,
      footer_brand: footerBrand,
      admin_console_title: adminConsoleTitle,
      admin_console_description: adminConsoleDescription,
    });
  });
}

export async function upsertConfigAction(formData: FormData): Promise<never> {
  return handleAction(formData, "upsertConfig", "检测配置已保存", async () => {
    const id = getOptionalText(formData, "id");
    const name = getText(formData, "name");
    const type = getText(formData, "type");
    const model = getText(formData, "model");
    const endpoint = getText(formData, "endpoint");

    if (!name || !type || !model || !endpoint) {
      throw new Error("名称、类型、模型和接口地址不能为空");
    }

    ensureProviderType(type);
    const normalizedEndpoint = normalizeProviderEndpoint(type, endpoint);

    const payload = {
      name,
      type,
      model,
      endpoint: normalizedEndpoint,
      api_key: await resolveApiKey(formData, id),
      enabled: getBoolean(formData, "enabled"),
      is_maintenance: getBoolean(formData, "is_maintenance"),
      template_id: getOptionalText(formData, "template_id"),
      group_name: getOptionalText(formData, "group_name"),
      request_header: parseJsonRecord(formData, "request_header", "请求头覆盖"),
      metadata: parseJsonRecord(formData, "metadata", "元数据"),
    };

    const storage = await getControlPlaneStorage();
    await storage.checkConfigs.upsert({id, ...payload});
  });
}

export async function deleteConfigAction(formData: FormData): Promise<never> {
  return handleAction(formData, "deleteConfig", "检测配置已删除", async () => {
    const id = getText(formData, "id");
    if (!id) {
      throw new Error("缺少配置 ID");
    }

    const storage = await getControlPlaneStorage();
    await storage.checkConfigs.delete(id);
  });
}

export async function upsertTemplateAction(formData: FormData): Promise<never> {
  return handleAction(formData, "upsertTemplate", "请求模板已保存", async () => {
    const id = getOptionalText(formData, "id");
    const name = getText(formData, "name");
    const type = getText(formData, "type");

    if (!name || !type) {
      throw new Error("模板名称和类型不能为空");
    }

    ensureProviderType(type);

    const payload = {
      name,
      type,
      request_header: parseJsonRecord(formData, "request_header", "模板请求头"),
      metadata: parseJsonRecord(formData, "metadata", "模板元数据"),
    };

    const storage = await getControlPlaneStorage();
    await storage.requestTemplates.upsert({id, ...payload});
  });
}

export async function deleteTemplateAction(formData: FormData): Promise<never> {
  return handleAction(formData, "deleteTemplate", "请求模板已删除", async () => {
    const id = getText(formData, "id");
    if (!id) {
      throw new Error("缺少模板 ID");
    }

    const storage = await getControlPlaneStorage();
    await storage.requestTemplates.delete(id);
  });
}

export async function upsertGroupAction(formData: FormData): Promise<never> {
  return handleAction(formData, "upsertGroup", "分组信息已保存", async () => {
    const id = getOptionalText(formData, "id");
    const groupName = getText(formData, "group_name");
    if (!groupName) {
      throw new Error("分组名称不能为空");
    }

    const payload = {
      group_name: groupName,
      website_url: getOptionalText(formData, "website_url"),
      tags: getOptionalText(formData, "tags"),
    };

    const storage = await getControlPlaneStorage();
    await storage.groups.upsert({id, ...payload});
  });
}

export async function deleteGroupAction(formData: FormData): Promise<never> {
  return handleAction(formData, "deleteGroup", "分组信息已删除", async () => {
    const id = getText(formData, "id");
    if (!id) {
      throw new Error("缺少分组 ID");
    }

    const storage = await getControlPlaneStorage();
    await storage.groups.delete(id);
  });
}

export async function upsertNotificationAction(formData: FormData): Promise<never> {
  return handleAction(formData, "upsertNotification", "系统通知已保存", async () => {
    const id = getOptionalText(formData, "id");
    const message = getText(formData, "message");
    const level = getText(formData, "level");

    if (!message || !level) {
      throw new Error("通知内容和级别不能为空");
    }

    ensureNotificationLevel(level);

    const payload = {
      message,
      level,
      is_active: getBoolean(formData, "is_active"),
    };

    const storage = await getControlPlaneStorage();
    await storage.notifications.upsert({id, ...payload});
  });
}

export async function deleteNotificationAction(formData: FormData): Promise<never> {
  return handleAction(
    formData,
    "deleteNotification",
    "系统通知已删除",
    async () => {
      const id = getText(formData, "id");
      if (!id) {
        throw new Error("缺少通知 ID");
      }

      const storage = await getControlPlaneStorage();
      await storage.notifications.delete(id);
    }
  );
}
