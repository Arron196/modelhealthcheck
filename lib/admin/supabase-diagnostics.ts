import "server-only";

import {createClient as createSupabaseClient} from "@supabase/supabase-js";

import {DEFAULT_SITE_SETTINGS, SITE_SETTINGS_SINGLETON_KEY} from "@/lib/types/site-settings";
import {createAdminClient} from "@/lib/supabase/admin";
import {ensureRuntimeMigrations, inspectRuntimeMigrations, type RuntimeMigrationCheck} from "@/lib/supabase/runtime-migrations";
import {getErrorMessage} from "@/lib/utils";

export type SupabaseDiagnosticStatus = "pass" | "warn" | "fail";
export type SupabaseDiagnosticScope = "shared" | "public" | "admin";

export interface SupabaseDiagnosticCheck {
  id: string;
  label: string;
  scope: SupabaseDiagnosticScope;
  status: SupabaseDiagnosticStatus;
  detail: string;
  hint?: string;
  durationMs?: number;
}

export interface SupabaseDiagnosticsReport {
  generatedAt: string;
  projectHost: string | null;
  schema: string;
  ok: boolean;
  passCount: number;
  warnCount: number;
  failCount: number;
  repairableCount: number;
  environmentChecks: SupabaseDiagnosticCheck[];
  clientChecks: SupabaseDiagnosticCheck[];
  relationChecks: SupabaseDiagnosticCheck[];
  migrationChecks: RuntimeMigrationCheck[];
  autoMigrationEnabled: boolean;
  autoMigrationConnectionSource: string | null;
  repairChecks: SupabaseRepairCheck[];
}

export interface SupabaseRepairCheck {
  id: string;
  label: string;
  status: "healthy" | "repairable" | "blocked";
  detail: string;
  hint?: string;
  affectedCount: number;
}

export interface SupabaseAutoFixResult {
  repairedCount: number;
  repairedItems: string[];
}

interface RelationManifestItem {
  id: string;
  label: string;
  relation: string;
  columns: string;
  scope: SupabaseDiagnosticScope;
}

interface RepairInspectionContext {
  missingGroupNames: string[];
  orphanTemplateConfigIds: string[];
  missingSiteSettingsRow: boolean;
}

interface DiagnosticSelectResult {
  data: unknown[] | null;
  error: unknown;
}

interface DiagnosticMutationResult {
  error: unknown;
}

interface DiagnosticClient {
  from: (relation: string) => {
    select: (columns: string) => {
      limit: (count: number) => PromiseLike<DiagnosticSelectResult>;
    };
    insert: (
      values: Record<string, unknown> | Array<Record<string, unknown>>
    ) => PromiseLike<DiagnosticMutationResult>;
    update: (values: Record<string, unknown>) => {
      in: (column: string, values: string[]) => PromiseLike<DiagnosticMutationResult>;
    };
  };
}

const DB_SCHEMA = process.env.SUPABASE_DB_SCHEMA?.trim() || "public";

const PUBLIC_RELATIONS: RelationManifestItem[] = [
  {
    id: "public-group-info",
    label: "公开分组信息",
    relation: "group_info",
    columns: "id",
    scope: "public",
  },
  {
    id: "public-system-notifications",
    label: "公开通知内容",
    relation: "system_notifications",
    columns: "id",
    scope: "public",
  },
];

const ADMIN_RELATIONS: RelationManifestItem[] = [
  {
    id: "admin-check-configs",
    label: "检测配置表",
    relation: "check_configs",
    columns: "id",
    scope: "admin",
  },
  {
    id: "admin-request-templates",
    label: "请求模板表",
    relation: "check_request_templates",
    columns: "id",
    scope: "admin",
  },
  {
    id: "admin-group-info",
    label: "分组信息表",
    relation: "group_info",
    columns: "id",
    scope: "admin",
  },
  {
    id: "admin-system-notifications",
    label: "系统通知表",
    relation: "system_notifications",
    columns: "id",
    scope: "admin",
  },
  {
    id: "admin-users",
    label: "管理员账户表",
    relation: "admin_users",
    columns: "id",
    scope: "admin",
  },
  {
    id: "admin-availability-stats",
    label: "可用性统计视图",
    relation: "availability_stats",
    columns: "config_id",
    scope: "admin",
  },
  {
    id: "admin-site-settings",
    label: "站点设置表",
    relation: "site_settings",
    columns: "singleton_key",
    scope: "admin",
  },
];

function maskValue(value: string | null | undefined): string {
  if (!value) {
    return "未配置";
  }

  if (value.length <= 8) {
    return `${value[0] ?? ""}***`;
  }

  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function getProjectHost(url: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function getKeyKind(value: string | null | undefined): string {
  const key = value?.trim();
  if (!key) {
    return "missing";
  }

  if (key.startsWith("sb_publishable_")) {
    return "publishable";
  }

  if (key.startsWith("sb_secret_")) {
    return "secret";
  }

  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
        role?: string;
      };
      if (payload.role === "anon") {
        return "anon-jwt";
      }
      if (payload.role === "service_role") {
        return "service-role-jwt";
      }
      return "jwt";
    } catch {
      return "jwt";
    }
  }

  return "unknown";
}

function isConnectivityLikeError(message: string): boolean {
  return /timeout|timed out|connect|network|fetch failed|dns|enotfound|tls|ssl/i.test(message);
}

function isPermissionLikeError(message: string): boolean {
  return /permission|row-level security|rls|forbidden|not allowed|insufficient/i.test(message);
}

function isSchemaLikeError(message: string): boolean {
  return /does not exist|schema|column|relation|invalid schema|cache lookup failed/i.test(message);
}

function isAuthLikeError(message: string): boolean {
  return /jwt|api key|apikey|auth|unauthorized|401|403|invalid token/i.test(message);
}

function buildEnvironmentChecks(): SupabaseDiagnosticCheck[] {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || "";
  const publicKey = process.env.SUPABASE_PUBLISHABLE_OR_ANON_KEY?.trim() || "";
  const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  const publicKeyKind = getKeyKind(publicKey);
  const adminKeyKind = getKeyKind(adminKey);
  const urlHost = getProjectHost(supabaseUrl);

  const checks: SupabaseDiagnosticCheck[] = [];

  checks.push({
    id: "env-supabase-url",
    label: "SUPABASE_URL",
    scope: "shared",
    status: urlHost ? "pass" : "fail",
    detail: urlHost ? `项目地址已配置：${urlHost}` : "缺少或不是合法的 HTTPS Supabase URL",
    hint: urlHost ? undefined : "请确认 SUPABASE_URL 指向正确的 Supabase 项目地址",
  });

  checks.push({
    id: "env-public-key",
    label: "SUPABASE_PUBLISHABLE_OR_ANON_KEY",
    scope: "public",
    status:
      !publicKey
        ? "fail"
        : publicKeyKind === "secret" || publicKeyKind === "service-role-jwt"
          ? "fail"
          : publicKeyKind === "unknown"
            ? "warn"
            : "pass",
    detail: !publicKey
      ? "未配置 public / anon key"
      : `已配置，类型判断为 ${publicKeyKind}，值 ${maskValue(publicKey)}`,
    hint: !publicKey
      ? "公开链路和 SSR 客户端需要这个 key"
      : publicKeyKind === "secret" || publicKeyKind === "service-role-jwt"
        ? "public key 位置不应放 service-role / secret key"
        : undefined,
  });

  checks.push({
    id: "env-admin-key",
    label: "SUPABASE_SERVICE_ROLE_KEY",
    scope: "admin",
    status:
      !adminKey
        ? "fail"
        : adminKeyKind === "publishable" || adminKeyKind === "anon-jwt"
          ? "fail"
          : adminKeyKind === "unknown"
            ? "warn"
            : "pass",
    detail: !adminKey
      ? "未配置 service-role / secret key"
      : `已配置，类型判断为 ${adminKeyKind}，值 ${maskValue(adminKey)}`,
    hint: !adminKey
      ? "后台管理、轮询和管理端写操作都依赖这个 key"
      : adminKeyKind === "publishable" || adminKeyKind === "anon-jwt"
        ? "service-role 位置不应放 publishable / anon key"
        : undefined,
  });

  checks.push({
    id: "env-db-schema",
    label: "SUPABASE_DB_SCHEMA",
    scope: "shared",
    status: DB_SCHEMA === "public" || DB_SCHEMA === "dev" ? "pass" : "warn",
    detail: `当前 schema：${DB_SCHEMA}`,
    hint:
      DB_SCHEMA === "public" || DB_SCHEMA === "dev"
        ? undefined
        : "项目默认按 public/dev 使用，其他 schema 需要确认相关对象已完整迁移",
  });

  return checks;
}

function createPublicDiagnosticClient() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const publicKey = process.env.SUPABASE_PUBLISHABLE_OR_ANON_KEY?.trim();

  if (!supabaseUrl || !publicKey) {
    throw new Error("缺少 SUPABASE_URL 或 SUPABASE_PUBLISHABLE_OR_ANON_KEY 环境变量");
  }

  return createSupabaseClient(supabaseUrl, publicKey, {
    db: {schema: DB_SCHEMA},
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

async function inspectRepairContext(client: DiagnosticClient): Promise<RepairInspectionContext> {
  const [configsResult, groupsResult, templatesResult, siteSettingsResult] = await Promise.all([
    client
      .from("check_configs")
      .select("id, type, template_id, group_name")
      .limit(500),
    client
      .from("group_info")
      .select("group_name")
      .limit(500),
    client
      .from("check_request_templates")
      .select("id, type")
      .limit(500),
    client
      .from("site_settings")
      .select("singleton_key")
      .limit(5),
  ]);

  if (configsResult.error) {
    throw new Error(`读取 check_configs 失败：${getErrorMessage(configsResult.error)}`);
  }
  if (groupsResult.error) {
    throw new Error(`读取 group_info 失败：${getErrorMessage(groupsResult.error)}`);
  }
  if (templatesResult.error) {
    throw new Error(`读取 check_request_templates 失败：${getErrorMessage(templatesResult.error)}`);
  }
  if (siteSettingsResult.error) {
    throw new Error(`读取 site_settings 失败：${getErrorMessage(siteSettingsResult.error)}`);
  }

  const configs = (configsResult.data ?? []) as Array<{
    id: string;
    type: string;
    template_id: string | null;
    group_name: string | null;
  }>;
  const existingGroups = new Set(
    ((groupsResult.data ?? []) as Array<{group_name: string}>).map((item) => item.group_name.trim())
  );
  const templateTypeMap = new Map(
    ((templatesResult.data ?? []) as Array<{id: string; type: string}>).map((item) => [item.id, item.type])
  );
  const siteSettingsRows = (siteSettingsResult.data ?? []) as Array<{singleton_key: string}>;

  const missingGroupNames = sortStrings(
    new Set(
      configs
        .map((item) => item.group_name?.trim() ?? "")
        .filter((item) => item && !existingGroups.has(item))
    )
  );

  const orphanTemplateConfigIds = configs
    .filter((item) => {
      if (!item.template_id) {
        return false;
      }

      const templateType = templateTypeMap.get(item.template_id);
      return !templateType || templateType !== item.type;
    })
    .map((item) => item.id);

  return {
    missingGroupNames,
    orphanTemplateConfigIds,
    missingSiteSettingsRow: !siteSettingsRows.some(
      (item) => item.singleton_key === SITE_SETTINGS_SINGLETON_KEY
    ),
  };
}

async function runClientCheck(input: {
  id: string;
  label: string;
  scope: SupabaseDiagnosticScope;
  createClient: () => unknown;
}): Promise<{check: SupabaseDiagnosticCheck; client: unknown | null}> {
  const startedAt = Date.now();

  try {
    const client = input.createClient();
    return {
      client,
      check: {
        id: input.id,
        label: input.label,
        scope: input.scope,
        status: "pass",
        detail: "客户端初始化成功",
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      client: null,
      check: {
        id: input.id,
        label: input.label,
        scope: input.scope,
        status: "fail",
        detail: `客户端初始化失败：${message}`,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}

async function runRelationCheck(
  client: DiagnosticClient | null,
  relation: RelationManifestItem
): Promise<SupabaseDiagnosticCheck> {
  if (!client) {
    return {
      id: relation.id,
      label: relation.label,
      scope: relation.scope,
      status: "fail",
      detail: "诊断客户端初始化失败，无法继续检查该对象",
      hint: "请先修复对应角色的环境变量或客户端初始化错误",
    };
  }

  const startedAt = Date.now();

  try {
    const {error} = await client.from(relation.relation).select(relation.columns).limit(1);
    if (!error) {
      return {
        id: relation.id,
        label: relation.label,
        scope: relation.scope,
        status: "pass",
        detail: `${relation.relation} 可读且查询成功`,
        durationMs: Date.now() - startedAt,
      };
    }

    const message = getErrorMessage(error);
    const status = relation.scope === "public" && isPermissionLikeError(message) ? "warn" : "fail";
    const hint = isConnectivityLikeError(message)
      ? "更像是网络、DNS、TLS 或超时问题"
      : isAuthLikeError(message)
        ? "更像是 key 类型错误、密钥失效或服务端鉴权失败"
        : isSchemaLikeError(message)
          ? "更像是缺少迁移、schema 选错，或对象名与代码不一致"
          : isPermissionLikeError(message)
            ? "更像是 RLS / 权限边界导致当前角色无法读取"
            : undefined;

    return {
      id: relation.id,
      label: relation.label,
      scope: relation.scope,
      status,
      detail: `${relation.relation} 查询失败：${message}`,
      hint,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id: relation.id,
      label: relation.label,
      scope: relation.scope,
      status: "fail",
      detail: `${relation.relation} 查询异常：${getErrorMessage(error)}`,
      hint: "通常表示网络中断或运行时抛出了未包装异常",
      durationMs: Date.now() - startedAt,
    };
  }
}

async function buildRepairChecks(client: DiagnosticClient | null): Promise<SupabaseRepairCheck[]> {
  if (!client) {
    return [
      {
        id: "repair-client-blocked",
        label: "自动修复前置条件",
        status: "blocked",
        detail: "Admin 诊断客户端未成功初始化，自动修复不可用。",
        hint: "先修复 service-role key、schema 或连接问题，再执行自动修复。",
        affectedCount: 0,
      },
    ];
  }

  try {
    const context = await inspectRepairContext(client);

    return [
      {
        id: "repair-missing-group-info",
        label: "缺失的 group_info 记录",
        status: context.missingGroupNames.length > 0 ? "repairable" : "healthy",
        detail:
          context.missingGroupNames.length > 0
            ? `检测到 ${context.missingGroupNames.length} 个分组仅存在于 check_configs 中，还没有 group_info 记录。`
            : "所有配置分组都已经有对应的 group_info 记录。",
        hint:
          context.missingGroupNames.length > 0
            ? "自动修复会为这些分组补齐最小 group_info 行，后续可再手动补官网链接与标签。"
            : undefined,
        affectedCount: context.missingGroupNames.length,
      },
      {
        id: "repair-orphan-template-refs",
        label: "失效的模板引用",
        status: context.orphanTemplateConfigIds.length > 0 ? "repairable" : "healthy",
        detail:
          context.orphanTemplateConfigIds.length > 0
            ? `检测到 ${context.orphanTemplateConfigIds.length} 条配置的 template_id 已失效或与 provider 类型不匹配。`
            : "没有发现失效或错配的 template_id 引用。",
        hint:
          context.orphanTemplateConfigIds.length > 0
            ? "自动修复会把这些配置的 template_id 置空，避免后台与加载器继续引用无效模板。"
            : undefined,
        affectedCount: context.orphanTemplateConfigIds.length,
      },
      {
        id: "repair-site-settings-singleton",
        label: "缺失的站点设置行",
        status: context.missingSiteSettingsRow ? "repairable" : "healthy",
        detail: context.missingSiteSettingsRow
          ? "检测到 site_settings 中还没有全局单例行，后台设置页会回退到默认品牌配置。"
          : "site_settings 单例行已存在。",
        hint: context.missingSiteSettingsRow
          ? "自动修复会补齐默认站点设置单例行，之后即可在后台继续自定义。"
          : undefined,
        affectedCount: context.missingSiteSettingsRow ? 1 : 0,
      },
    ];
  } catch (error) {
    return [
      {
        id: "repair-inspection-failed",
        label: "自动修复预检查",
        status: "blocked",
        detail: `无法完成自动修复预检查：${getErrorMessage(error)}`,
        hint: "先修复基础连接或 schema 问题，再重试自动修复。",
        affectedCount: 0,
      },
    ];
  }
}

export async function runSupabaseAutoFix(): Promise<SupabaseAutoFixResult> {
  await ensureRuntimeMigrations({ids: ["site-settings"]});
  const client = createAdminClient();
  const context = await inspectRepairContext(client);
  const repairedItems: string[] = [];

  if (context.missingGroupNames.length > 0) {
    const payload = context.missingGroupNames.map((groupName) => ({group_name: groupName}));
    const {error} = await client.from("group_info").insert(payload);
    if (error) {
      throw new Error(`补齐 group_info 失败：${getErrorMessage(error)}`);
    }
    repairedItems.push(`已补齐 ${context.missingGroupNames.length} 条 group_info 记录`);
  }

  if (context.orphanTemplateConfigIds.length > 0) {
    const {error} = await client
      .from("check_configs")
      .update({template_id: null})
      .in("id", context.orphanTemplateConfigIds);
    if (error) {
      throw new Error(`清理失效模板引用失败：${getErrorMessage(error)}`);
    }
    repairedItems.push(`已清理 ${context.orphanTemplateConfigIds.length} 条失效模板引用`);
  }

  if (context.missingSiteSettingsRow) {
    const {error} = await client.from("site_settings").insert({
      singleton_key: SITE_SETTINGS_SINGLETON_KEY,
      site_name: DEFAULT_SITE_SETTINGS.siteName,
      site_description: DEFAULT_SITE_SETTINGS.siteDescription,
      hero_badge: DEFAULT_SITE_SETTINGS.heroBadge,
      hero_title_primary: DEFAULT_SITE_SETTINGS.heroTitlePrimary,
      hero_title_secondary: DEFAULT_SITE_SETTINGS.heroTitleSecondary,
      hero_description: DEFAULT_SITE_SETTINGS.heroDescription,
      footer_brand: DEFAULT_SITE_SETTINGS.footerBrand,
      admin_console_title: DEFAULT_SITE_SETTINGS.adminConsoleTitle,
      admin_console_description: DEFAULT_SITE_SETTINGS.adminConsoleDescription,
    });
    if (error) {
      throw new Error(`补齐 site_settings 失败：${getErrorMessage(error)}`);
    }
    repairedItems.push("已补齐站点设置单例行");
  }

  return {
    repairedCount: repairedItems.length,
    repairedItems,
  };
}

export async function runSupabaseDiagnostics(): Promise<SupabaseDiagnosticsReport> {
  const environmentChecks = buildEnvironmentChecks();

  const [publicClientResult, adminClientResult] = await Promise.all([
    runClientCheck({
      id: "client-public",
      label: "Public 诊断客户端",
      scope: "public",
      createClient: createPublicDiagnosticClient,
    }),
    runClientCheck({
      id: "client-admin",
      label: "Admin 诊断客户端",
      scope: "admin",
      createClient: createAdminClient,
    }),
  ]);

  const relationChecks = await Promise.all([
    ...PUBLIC_RELATIONS.map((item) => runRelationCheck(publicClientResult.client as DiagnosticClient | null, item)),
    ...ADMIN_RELATIONS.map((item) => runRelationCheck(adminClientResult.client as DiagnosticClient | null, item)),
  ]);
  const [repairChecks, migrationInspection] = await Promise.all([
    buildRepairChecks(adminClientResult.client as DiagnosticClient | null),
    inspectRuntimeMigrations(),
  ]);

  const checks = [...environmentChecks, publicClientResult.check, adminClientResult.check, ...relationChecks];
  const passCount = checks.filter((item) => item.status === "pass").length;
  const warnCount = checks.filter((item) => item.status === "warn").length;
  const failCount = checks.filter((item) => item.status === "fail").length;
  const repairableCount = repairChecks.reduce(
    (count, item) => count + (item.status === "repairable" ? item.affectedCount : 0),
    0
  );

  return {
    generatedAt: new Date().toISOString(),
    projectHost: getProjectHost(process.env.SUPABASE_URL?.trim() || null),
    schema: DB_SCHEMA,
    ok: failCount === 0,
    passCount,
    warnCount,
    failCount,
    repairableCount,
    environmentChecks,
    clientChecks: [publicClientResult.check, adminClientResult.check],
    relationChecks,
    migrationChecks: migrationInspection.checks,
    autoMigrationEnabled: migrationInspection.autoMigrateEnabled,
    autoMigrationConnectionSource: migrationInspection.connectionSource,
    repairChecks,
  };
}
