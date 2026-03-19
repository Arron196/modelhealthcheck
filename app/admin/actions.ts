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
import {importControlPlaneToTarget, verifyManagedStorageImport} from "@/lib/admin/managed-storage-import";
import {runPostgresConnectionDiagnostics} from "@/lib/admin/postgres-connection-diagnostics";
import {runSupabaseAutoFix} from "@/lib/admin/supabase-diagnostics";
import {ADMIN_NOTIFICATION_LEVELS, ADMIN_PROVIDER_TYPES} from "@/lib/admin/data";
import {invalidateStorageDiagnosticsCache} from "@/lib/admin/storage-diagnostics-cache";
import {invalidateDashboardCache} from "@/lib/core/dashboard-data";
import {clearPingCache} from "@/lib/core/global-state";
import {invalidateGroupDashboardCache} from "@/lib/core/group-data";
import {invalidateAvailabilityCache} from "@/lib/database/availability";
import {invalidateConfigCache} from "@/lib/database/config-loader";
import {invalidateGroupInfoCache} from "@/lib/database/group-info";
import {invalidateSiteSettingsCache} from "@/lib/site-settings";
import {
  activateManagedStorageDraft,
  recordManagedPostgresTestReport,
  recordManagedStorageImportResult,
  resetManagedStorageImportState,
  updateManagedStorageDraft,
} from "@/lib/storage/bootstrap-store";
import {getControlPlaneStorage, resetStorageResolverCaches} from "@/lib/storage/resolver";
import {createSupabaseControlPlaneStorage} from "@/lib/storage/supabase";
import {ensureRuntimeMigrations, invalidateRuntimeMigrationCache} from "@/lib/supabase/runtime-migrations";
import {normalizeProviderEndpoint} from "@/lib/providers/endpoint-utils";
import {getErrorMessage, logError} from "@/lib/utils";
import {SITE_SETTINGS_SINGLETON_KEY} from "@/lib/types/site-settings";

type JsonRecord = Record<string, unknown>;
type ManagedStorageProvider = "supabase" | "postgres";
type ManagedStorageBackupProvider = ManagedStorageProvider | "none";

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

function ensureManagedStorageProvider(value: string): asserts value is ManagedStorageProvider {
  if (value !== "supabase" && value !== "postgres") {
    throw new Error("主后端仅支持 Supabase 或 PostgreSQL");
  }
}

function ensureManagedStorageBackupProvider(
  value: string
): asserts value is ManagedStorageBackupProvider {
  if (value !== "supabase" && value !== "postgres" && value !== "none") {
    throw new Error("备用后端仅支持 Supabase、PostgreSQL 或 none");
  }
}

function readManagedStorageDraft(formData: FormData): {
  postgresConnectionString: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseServiceRoleKey: string;
  supabaseDbUrl: string;
  draftPrimaryProvider: ManagedStorageProvider;
  draftBackupProvider: ManagedStorageBackupProvider;
} {
  const draftPrimaryProvider = getText(formData, "draft_primary_provider");
  const draftBackupProvider = getText(formData, "draft_backup_provider");
  ensureManagedStorageProvider(draftPrimaryProvider);
  ensureManagedStorageBackupProvider(draftBackupProvider);

  if (draftPrimaryProvider === draftBackupProvider) {
    throw new Error("主后端和备用后端不能相同");
  }

  return {
    postgresConnectionString: getText(formData, "postgres_connection_string"),
    supabaseUrl: getText(formData, "supabase_url"),
    supabasePublishableKey: getText(formData, "supabase_publishable_or_anon_key"),
    supabaseServiceRoleKey: getText(formData, "supabase_service_role_key"),
    supabaseDbUrl: getText(formData, "supabase_db_url"),
    draftPrimaryProvider,
    draftBackupProvider,
  };
}

function resolveManagedImportTarget(draft: {
  draftPrimaryProvider: ManagedStorageProvider;
  draftBackupProvider: ManagedStorageBackupProvider;
}): ManagedStorageProvider {
  return draft.draftPrimaryProvider === "postgres" || draft.draftBackupProvider === "postgres"
    ? "postgres"
    : "supabase";
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
  invalidateGroupDashboardCache();
  invalidateAvailabilityCache();
  invalidateStorageDiagnosticsCache();
  invalidateSiteSettingsCache();
  invalidateRuntimeMigrationCache();
  clearPingCache();
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
    redirect(
      buildRedirectUrl(
        "/admin/storage",
        "success",
        "首个管理员已创建。现在可以保留 SQLite，或继续配置 PostgreSQL / Supabase。"
      )
    );
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

export async function saveManagedStorageDraftAction(formData: FormData): Promise<never> {
  return handleAction(formData, "saveManagedStorageDraft", "后端草稿配置已保存", async () => {
    updateManagedStorageDraft(readManagedStorageDraft(formData));
  });
}

export async function testManagedPostgresAction(formData: FormData): Promise<never> {
  return handleAction(formData, "testManagedPostgres", "PostgreSQL 连接测试完成", async () => {
    const draft = updateManagedStorageDraft(readManagedStorageDraft(formData));
    const connectionString = draft.postgresConnectionString;
    if (!connectionString) {
      throw new Error("请先填写 PostgreSQL 连接串");
    }

    const report = await runPostgresConnectionDiagnostics(connectionString);
    recordManagedPostgresTestReport(report);

    if (!report.ok) {
      throw new Error("PostgreSQL 连接测试未通过，请先修复失败项后再导入或启用");
    }
  });
}

export async function importManagedStorageAction(formData: FormData): Promise<never> {
  return handleAction(formData, "importManagedStorage", "当前数据（含历史记录）已导入目标后端", async () => {
    const draft = updateManagedStorageDraft(readManagedStorageDraft(formData));
    const targetProvider = resolveManagedImportTarget(draft);

    if (targetProvider === "postgres" && !draft.postgresConnectionString) {
      throw new Error("缺少 PostgreSQL 连接串，无法导入");
    }
    if (targetProvider === "postgres" && !draft.postgresLastTestOk) {
      throw new Error("请先完成并通过 PostgreSQL 连接测试");
    }
    if (targetProvider === "supabase" && !draft.hasSupabaseAdminCredentials) {
      throw new Error("请先填写 Supabase URL 与 service-role key，再执行导入");
    }

    const sourceStorage = await getControlPlaneStorage();
    resetManagedStorageImportState();
    const summary = await importControlPlaneToTarget({
      sourceStorage,
      targetProvider,
      postgresConnectionString: draft.postgresConnectionString,
    });
    recordManagedStorageImportResult({ok: true, summary});
  });
}

export async function activateManagedStorageAction(formData: FormData): Promise<never> {
  return handleAction(formData, "activateManagedStorage", "托管存储配置已启用", async () => {
    const draft = updateManagedStorageDraft(readManagedStorageDraft(formData));
    const currentStorage = await getControlPlaneStorage();
    const importTargetProvider = resolveManagedImportTarget(draft);

    const usesSupabase =
      draft.draftPrimaryProvider === "supabase" || draft.draftBackupProvider === "supabase";
    if (usesSupabase && !draft.hasSupabaseAdminCredentials) {
      throw new Error("请先填写 Supabase URL 与 service-role key，才能把 Supabase 设为主后端或备用后端");
    }
    if (usesSupabase) {
      const supabaseStorage = createSupabaseControlPlaneStorage({allowDraft: true});
      await supabaseStorage.ensureReady();
    }

    if (
      draft.draftPrimaryProvider === "supabase" &&
      importTargetProvider === "postgres" &&
      currentStorage.provider !== "supabase"
    ) {
      throw new Error(
        "当前初始化流程还不能在一次启用中同时把现有数据（含历史记录）导入到 Supabase 主库并预热 PostgreSQL 备用库。请先把主后端设为 Supabase（备用后端设为 none）完成导入与启用，随后再把 PostgreSQL 配成备用后端。"
      );
    }

    const usesPostgres =
      draft.draftPrimaryProvider === "postgres" || draft.draftBackupProvider === "postgres";
    if (usesPostgres) {
      if (!draft.postgresConnectionString) {
        throw new Error("请先填写 PostgreSQL 连接串");
      }
      if (!draft.postgresLastTestOk) {
        throw new Error("请先完成并通过 PostgreSQL 连接测试");
      }
      if (!draft.lastImportOk) {
        throw new Error("请先把当前数据（含历史记录）导入 PostgreSQL，再执行启用");
      }
    }

    if (importTargetProvider === "supabase" && currentStorage.provider !== "supabase") {
      if (!draft.lastImportOk || draft.lastImportSummary?.targetProvider !== "supabase") {
        throw new Error("请先把当前数据（含历史记录）导入 Supabase，再执行启用");
      }
    }

    if (importTargetProvider === "postgres" && currentStorage.provider !== "postgres") {
      if (!draft.lastImportOk || draft.lastImportSummary?.targetProvider !== "postgres") {
        throw new Error("请先把当前数据（含历史记录）导入 PostgreSQL，再执行启用");
      }
    }

    if (draft.lastImportSummary) {
      const verification = await verifyManagedStorageImport({
        sourceStorage: currentStorage,
        targetProvider: importTargetProvider,
        postgresConnectionString: draft.postgresConnectionString,
        summary: draft.lastImportSummary,
      });

      if (!verification.sourceMatchesImport) {
        throw new Error("导入完成后源端数据（含历史记录）已发生变化，请重新导入后再执行启用，避免切换到过期数据");
      }

      if (!verification.targetMatchesImport) {
        throw new Error("目标后端数据（含历史记录）与最近一次导入结果不一致，请重新导入后再执行启用");
      }
    }

    activateManagedStorageDraft();
    await resetStorageResolverCaches();
  });
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
