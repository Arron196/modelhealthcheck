import "server-only";

import {Client} from "pg";

import type {StorageDiagnosticCheck} from "@/lib/admin/storage-diagnostics";
import {getErrorMessage} from "@/lib/utils";

const EXPECTED_CONTROL_PLANE_TABLES = [
  "admin_users",
  "site_settings",
  "check_configs",
  "check_request_templates",
  "group_info",
  "system_notifications",
] as const;
const POSTGRES_TEST_TIMEOUT_MS = 10_000;

function isLocalHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1"].includes(hostname);
}

function getSslMode(hostname: string): "disable" | "require" {
  return isLocalHost(hostname) ? "disable" : "require";
}

function isAllowedProtocol(protocol: string): boolean {
  return protocol === "postgres:" || protocol === "postgresql:";
}

export interface PostgresConnectionTestReport {
  testedAt: string;
  ok: boolean;
  host: string | null;
  port: string | null;
  database: string | null;
  sslMode: "disable" | "require" | "unknown";
  currentUser: string | null;
  serverVersion: string | null;
  checks: StorageDiagnosticCheck[];
}

export async function runPostgresConnectionDiagnostics(
  connectionString: string
): Promise<PostgresConnectionTestReport> {
  const trimmed = connectionString.trim();
  const testedAt = new Date().toISOString();

  if (!trimmed) {
    return {
      testedAt,
      ok: false,
      host: null,
      port: null,
      database: null,
      sslMode: "unknown",
      currentUser: null,
      serverVersion: null,
      checks: [
        {
          id: "postgres-candidate-missing",
          label: "候选连接串",
          status: "fail",
          detail: "请输入要测试的 PostgreSQL 连接串。",
          hint: "格式示例：postgresql://user:password@host:5432/database",
        },
      ],
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch (error) {
    return {
      testedAt,
      ok: false,
      host: null,
      port: null,
      database: null,
      sslMode: "unknown",
      currentUser: null,
      serverVersion: null,
      checks: [
        {
          id: "postgres-candidate-parse",
          label: "连接串格式",
          status: "fail",
          detail: `连接串格式无效：${getErrorMessage(error)}`,
          hint: "请确认使用 postgresql:// 或 postgres:// 开头，并包含主机与数据库名。",
        },
      ],
    };
  }

  if (!isAllowedProtocol(parsedUrl.protocol)) {
    return {
      testedAt,
      ok: false,
      host: parsedUrl.hostname || null,
      port: parsedUrl.port || null,
      database: parsedUrl.pathname.replace(/^\//, "") || null,
      sslMode: "unknown",
      currentUser: null,
      serverVersion: null,
      checks: [
        {
          id: "postgres-candidate-protocol",
          label: "连接串协议",
          status: "fail",
          detail: `当前协议为 ${parsedUrl.protocol}，不是 PostgreSQL 连接串。`,
          hint: "请使用 postgres:// 或 postgresql:// 协议。",
        },
      ],
    };
  }

  const host = parsedUrl.hostname || null;
  const port = parsedUrl.port || null;
  const database = parsedUrl.pathname.replace(/^\//, "") || null;
  const sslMode = host ? getSslMode(host) : "unknown";
  const checks: StorageDiagnosticCheck[] = [
    {
      id: "postgres-candidate-parse",
      label: "连接串格式",
      status: host && database ? "pass" : "warn",
      detail: `已解析主机 ${host ?? "—"}、数据库 ${database ?? "—"}${port ? `、端口 ${port}` : ""}`,
      hint: host && database ? undefined : "建议同时确认数据库名、端口和凭据部分是否完整。",
    },
  ];

  const client = new Client({
    connectionString: trimmed,
    connectionTimeoutMillis: POSTGRES_TEST_TIMEOUT_MS,
    query_timeout: POSTGRES_TEST_TIMEOUT_MS,
    statement_timeout: POSTGRES_TEST_TIMEOUT_MS,
    ssl: host ? (sslMode === "disable" ? false : {rejectUnauthorized: false}) : false,
  });

  try {
    await client.connect();

    checks.push({
      id: "postgres-connect",
      label: "连接握手",
      status: "pass",
      detail: "已成功建立数据库连接。",
    });

    const identityResult = await client.query<{
      current_database: string;
      current_user: string;
      version: string;
    }>(`select current_database(), current_user, version()`);
    const identity = identityResult.rows[0];

    const privilegeResult = await client.query<{
      schema_usage: boolean;
      schema_create: boolean;
    }>(
      `
        select
          has_schema_privilege(current_user, 'public', 'USAGE') as schema_usage,
          has_schema_privilege(current_user, 'public', 'CREATE') as schema_create
      `
    );
    const privileges = privilegeResult.rows[0];

    checks.push({
      id: "postgres-privileges",
      label: "public schema 权限",
      status: privileges?.schema_usage
        ? privileges.schema_create
          ? "pass"
          : "warn"
        : "fail",
      detail: privileges?.schema_usage
        ? privileges.schema_create
          ? "具备 USAGE + CREATE 权限，可支持控制面自动建表。"
          : "具备 USAGE，但缺少 CREATE 权限；若目标库尚未建表，首次接管时可能失败。"
        : "当前账户缺少 public schema 的基础使用权限。",
      hint: privileges?.schema_create
        ? undefined
        : "如果你计划把它作为控制面后端，建议确认当前账户至少能在 public schema 创建表。",
    });

    const tableResult = await client.query<{table_name: string}>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public' and table_name = any($1)
      `,
      [EXPECTED_CONTROL_PLANE_TABLES]
    );
    const existingTables = new Set(tableResult.rows.map((row) => row.table_name));
    const missingTables = EXPECTED_CONTROL_PLANE_TABLES.filter((tableName) => !existingTables.has(tableName));

    checks.push({
      id: "postgres-control-plane-schema",
      label: "控制面表结构",
      status:
        missingTables.length === 0
          ? "pass"
          : missingTables.length === EXPECTED_CONTROL_PLANE_TABLES.length
            ? "warn"
            : "warn",
      detail:
        missingTables.length === 0
          ? `已检测到全部 ${EXPECTED_CONTROL_PLANE_TABLES.length} 张控制面表。`
          : `当前已存在 ${EXPECTED_CONTROL_PLANE_TABLES.length - missingTables.length}/${EXPECTED_CONTROL_PLANE_TABLES.length} 张控制面表，缺失：${missingTables.join(", ")}`,
      hint:
        missingTables.length === 0
          ? undefined
          : "当前测试是只读探测，不会代你建表；项目真正切到 Postgres 运行时会在首次使用时尝试自动准备控制面表。",
    });

    const ok = checks.every((check) => check.status !== "fail");

    return {
      testedAt,
      ok,
      host,
      port,
      database: identity?.current_database ?? database,
      sslMode,
      currentUser: identity?.current_user ?? null,
      serverVersion: identity?.version ?? null,
      checks,
    };
  } catch (error) {
    const hasConnected = checks.some((check) => check.id === "postgres-connect" && check.status === "pass");
    checks.push({
      id: hasConnected ? "postgres-post-connect" : "postgres-connect",
      label: hasConnected ? "连接后探测" : "连接握手",
      status: "fail",
      detail: `${hasConnected ? "连接后探测失败" : "数据库连接失败"}：${getErrorMessage(error)}`,
      hint: hasConnected
        ? "数据库已可达，但后续权限、schema 或系统视图查询没有通过。请继续检查当前账号权限和目标库状态。"
        : "请检查主机、端口、用户名/密码、防火墙，以及是否需要改用可直连的内网地址。",
    });

    return {
      testedAt,
      ok: false,
      host,
      port,
      database,
      sslMode,
      currentUser: null,
      serverVersion: null,
      checks,
    };
  } finally {
    try {
      await client.end();
    } catch {
    }
  }
}
