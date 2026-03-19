import "server-only";

import {randomBytes} from "node:crypto";
import {mkdirSync} from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type {PostgresConnectionTestReport} from "@/lib/admin/postgres-connection-diagnostics";

const DEFAULT_BOOTSTRAP_SQLITE_RELATIVE_PATH = path.join(
  ".sisyphus",
  "local-data",
  "storage-bootstrap.db"
);
const BOOTSTRAP_SINGLETON_ID = "global";

export type ManagedStorageProvider = "supabase" | "postgres";
export type ManagedStorageBackupProvider = ManagedStorageProvider | "none";
export type ManagedStorageImportSourceProvider = ManagedStorageProvider | "sqlite";

export interface ManagedStorageImportSummary {
  importedAt: string;
  sourceProvider: ManagedStorageImportSourceProvider;
  targetProvider: ManagedStorageProvider;
  sourceFingerprint: string;
  targetFingerprint: string;
  counts: {
    adminUsers: number;
    checkConfigs: number;
    historyRows: number;
    requestTemplates: number;
    groups: number;
    notifications: number;
    hasSiteSettings: boolean;
  };
}

export interface ManagedStorageSettings {
  adminSessionSecretConfigured: boolean;
  postgresConnectionString: string | null;
  postgresConnectionMasked: string | null;
  supabaseUrl: string | null;
  supabaseProjectHost: string | null;
  supabasePublishableKeyMasked: string | null;
  supabaseServiceRoleKeyMasked: string | null;
  supabaseDbUrlMasked: string | null;
  hasSupabaseAdminCredentials: boolean;
  hasSupabasePublicCredentials: boolean;
  postgresTestReport: PostgresConnectionTestReport | null;
  postgresLastTestedAt: string | null;
  postgresLastTestOk: boolean;
  lastImportSummary: ManagedStorageImportSummary | null;
  lastImportOk: boolean;
  draftPrimaryProvider: ManagedStorageProvider;
  draftBackupProvider: ManagedStorageBackupProvider;
  activePrimaryProvider: ManagedStorageProvider | null;
  activeBackupProvider: ManagedStorageBackupProvider;
  activationGeneration: number;
  activatedAt: string | null;
  updatedAt: string | null;
}

interface ManagedStorageRow {
  id: string;
  admin_session_secret: string | null;
  postgres_connection_string: string | null;
  supabase_url: string | null;
  supabase_publishable_key: string | null;
  supabase_service_role_key: string | null;
  supabase_db_url: string | null;
  postgres_test_report: string | null;
  postgres_last_tested_at: string | null;
  postgres_last_test_ok: number;
  last_import_summary: string | null;
  last_import_ok: number;
  draft_primary_provider: ManagedStorageProvider;
  draft_backup_provider: ManagedStorageBackupProvider;
  active_primary_provider: ManagedStorageProvider | null;
  active_backup_provider: ManagedStorageBackupProvider;
  activation_generation: number;
  activated_at: string | null;
  updated_at: string | null;
}

let bootstrapDbCache:
  | {
      filePath: string;
      db: Database.Database;
    }
  | null = null;

function normalizeEnv(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getBootstrapFilePath(): string {
  const configured = normalizeEnv(process.env.STORAGE_BOOTSTRAP_SQLITE_PATH);
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }

  return path.resolve(process.cwd(), DEFAULT_BOOTSTRAP_SQLITE_RELATIVE_PATH);
}

function getBootstrapDb(): Database.Database {
  const filePath = getBootstrapFilePath();
  if (bootstrapDbCache?.filePath === filePath) {
    return bootstrapDbCache.db;
  }

  mkdirSync(path.dirname(filePath), {recursive: true});
  const db = new Database(filePath) as Database.Database;
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS managed_storage_settings (
      id text PRIMARY KEY,
      admin_session_secret text,
      postgres_connection_string text,
      supabase_url text,
      supabase_publishable_key text,
      supabase_service_role_key text,
      supabase_db_url text,
      postgres_test_report text,
      postgres_last_tested_at text,
      postgres_last_test_ok integer NOT NULL DEFAULT 0,
      last_import_summary text,
      last_import_ok integer NOT NULL DEFAULT 0,
      draft_primary_provider text NOT NULL DEFAULT 'supabase',
      draft_backup_provider text NOT NULL DEFAULT 'postgres',
      active_primary_provider text,
      active_backup_provider text NOT NULL DEFAULT 'none',
      activation_generation integer NOT NULL DEFAULT 0,
      activated_at text,
      updated_at text NOT NULL
    )
  `);

  ensureColumn(db, "managed_storage_settings", "admin_session_secret", "ALTER TABLE managed_storage_settings ADD COLUMN admin_session_secret text");
  ensureColumn(db, "managed_storage_settings", "supabase_url", "ALTER TABLE managed_storage_settings ADD COLUMN supabase_url text");
  ensureColumn(db, "managed_storage_settings", "supabase_publishable_key", "ALTER TABLE managed_storage_settings ADD COLUMN supabase_publishable_key text");
  ensureColumn(db, "managed_storage_settings", "supabase_service_role_key", "ALTER TABLE managed_storage_settings ADD COLUMN supabase_service_role_key text");
  ensureColumn(db, "managed_storage_settings", "supabase_db_url", "ALTER TABLE managed_storage_settings ADD COLUMN supabase_db_url text");

  bootstrapDbCache = {filePath, db};
  return db;
}

function ensureColumn(db: Database.Database, tableName: string, columnName: string, statement: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{name: string}>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(statement);
}

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toBool(value: number | null | undefined): boolean {
  return value === 1;
}

function maskConnectionString(connectionString: string | null): string | null {
  if (!connectionString) {
    return null;
  }

  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = "********";
    }
    return url.toString();
  } catch {
    return "postgresql://********";
  }
}

function maskSecret(secret: string | null): string | null {
  if (!secret) {
    return null;
  }

  if (secret.length <= 8) {
    return `${secret[0] ?? ""}***`;
  }

  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
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

function ensureSingletonRow(): ManagedStorageRow {
  const db = getBootstrapDb();
  const existing = db
    .prepare(`SELECT * FROM managed_storage_settings WHERE id = ? LIMIT 1`)
    .get(BOOTSTRAP_SINGLETON_ID) as ManagedStorageRow | undefined;

  if (existing) {
    return existing;
  }

  const updatedAt = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO managed_storage_settings (
        id,
        draft_primary_provider,
        draft_backup_provider,
        active_backup_provider,
        updated_at
      )
      VALUES (?, 'supabase', 'postgres', 'none', ?)
    `
  ).run(BOOTSTRAP_SINGLETON_ID, updatedAt);

  return db
    .prepare(`SELECT * FROM managed_storage_settings WHERE id = ? LIMIT 1`)
    .get(BOOTSTRAP_SINGLETON_ID) as ManagedStorageRow;
}

function mapRow(row: ManagedStorageRow): ManagedStorageSettings {
  return {
    adminSessionSecretConfigured: Boolean(row.admin_session_secret),
    postgresConnectionString: row.postgres_connection_string,
    postgresConnectionMasked: maskConnectionString(row.postgres_connection_string),
    supabaseUrl: row.supabase_url,
    supabaseProjectHost: getProjectHost(row.supabase_url),
    supabasePublishableKeyMasked: maskSecret(row.supabase_publishable_key),
    supabaseServiceRoleKeyMasked: maskSecret(row.supabase_service_role_key),
    supabaseDbUrlMasked: maskConnectionString(row.supabase_db_url),
    hasSupabaseAdminCredentials: Boolean(row.supabase_url && row.supabase_service_role_key),
    hasSupabasePublicCredentials: Boolean(row.supabase_url && row.supabase_publishable_key),
    postgresTestReport: parseJson<PostgresConnectionTestReport>(row.postgres_test_report),
    postgresLastTestedAt: row.postgres_last_tested_at,
    postgresLastTestOk: toBool(row.postgres_last_test_ok),
    lastImportSummary: parseJson<ManagedStorageImportSummary>(row.last_import_summary),
    lastImportOk: toBool(row.last_import_ok),
    draftPrimaryProvider: row.draft_primary_provider,
    draftBackupProvider: row.draft_backup_provider,
    activePrimaryProvider: row.active_primary_provider,
    activeBackupProvider: row.active_backup_provider,
    activationGeneration: row.activation_generation,
    activatedAt: row.activated_at,
    updatedAt: row.updated_at,
  };
}

function touchUpdate(sql: string, params: Array<unknown>): void {
  const db = getBootstrapDb();
  db.prepare(sql).run(...params, new Date().toISOString(), BOOTSTRAP_SINGLETON_ID);
}

export function invalidateBootstrapStoreCache(): void {
  if (bootstrapDbCache) {
    try {
      bootstrapDbCache.db.close();
    } catch {
    }
  }

  bootstrapDbCache = null;
}

export function loadManagedStorageSettings(): ManagedStorageSettings {
  return mapRow(ensureSingletonRow());
}

export function updateManagedStorageDraft(input: {
  postgresConnectionString: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseServiceRoleKey: string;
  supabaseDbUrl: string;
  draftPrimaryProvider: ManagedStorageProvider;
  draftBackupProvider: ManagedStorageBackupProvider;
}): ManagedStorageSettings {
  const currentRow = ensureSingletonRow();
  const current = mapRow(currentRow);
  const nextConnectionString = input.postgresConnectionString.trim() || currentRow.postgres_connection_string;
  const nextSupabaseUrl = input.supabaseUrl.trim() || currentRow.supabase_url;
  const nextSupabasePublishableKey =
    input.supabasePublishableKey.trim() || currentRow.supabase_publishable_key;
  const nextSupabaseServiceRoleKey =
    input.supabaseServiceRoleKey.trim() || currentRow.supabase_service_role_key;
  const nextSupabaseDbUrl = input.supabaseDbUrl.trim() || currentRow.supabase_db_url;
  const shouldResetReadiness =
    nextConnectionString !== current.postgresConnectionString ||
    nextSupabaseUrl !== currentRow.supabase_url ||
    nextSupabasePublishableKey !== currentRow.supabase_publishable_key ||
    nextSupabaseServiceRoleKey !== currentRow.supabase_service_role_key ||
    nextSupabaseDbUrl !== currentRow.supabase_db_url ||
    input.draftPrimaryProvider !== current.draftPrimaryProvider ||
    input.draftBackupProvider !== current.draftBackupProvider;
  touchUpdate(
    `
      UPDATE managed_storage_settings
      SET postgres_connection_string = ?,
          supabase_url = ?,
          supabase_publishable_key = ?,
          supabase_service_role_key = ?,
          supabase_db_url = ?,
          postgres_test_report = ?,
          postgres_last_tested_at = ?,
          postgres_last_test_ok = ?,
          last_import_summary = ?,
          last_import_ok = ?,
          draft_primary_provider = ?,
          draft_backup_provider = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [
      nextConnectionString,
      nextSupabaseUrl,
      nextSupabasePublishableKey,
      nextSupabaseServiceRoleKey,
      nextSupabaseDbUrl,
      shouldResetReadiness ? null : JSON.stringify(current.postgresTestReport),
      shouldResetReadiness ? null : current.postgresLastTestedAt,
      shouldResetReadiness ? 0 : current.postgresLastTestOk ? 1 : 0,
      shouldResetReadiness ? null : JSON.stringify(current.lastImportSummary),
      shouldResetReadiness ? 0 : current.lastImportOk ? 1 : 0,
      input.draftPrimaryProvider,
      input.draftBackupProvider,
    ]
  );

  return loadManagedStorageSettings();
}

export function recordManagedPostgresTestReport(report: PostgresConnectionTestReport): ManagedStorageSettings {
  touchUpdate(
    `
      UPDATE managed_storage_settings
      SET postgres_test_report = ?,
          postgres_last_tested_at = ?,
          postgres_last_test_ok = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [JSON.stringify(report), report.testedAt, report.ok ? 1 : 0]
  );

  return loadManagedStorageSettings();
}

export function recordManagedStorageImportResult(input: {
  ok: boolean;
  summary: ManagedStorageImportSummary;
}): ManagedStorageSettings {
  touchUpdate(
    `
      UPDATE managed_storage_settings
      SET last_import_summary = ?,
          last_import_ok = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [JSON.stringify(input.summary), input.ok ? 1 : 0]
  );

  return loadManagedStorageSettings();
}

export function resetManagedStorageImportState(): ManagedStorageSettings {
  touchUpdate(
    `
      UPDATE managed_storage_settings
      SET last_import_summary = ?,
          last_import_ok = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [null, 0]
  );

  return loadManagedStorageSettings();
}

export function activateManagedStorageDraft(): ManagedStorageSettings {
  const current = loadManagedStorageSettings();
  const nextGeneration = current.activationGeneration + 1;
  const activatedAt = new Date().toISOString();
  touchUpdate(
    `
      UPDATE managed_storage_settings
      SET active_primary_provider = ?,
          active_backup_provider = ?,
          activation_generation = ?,
          activated_at = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [
      current.draftPrimaryProvider,
      current.draftBackupProvider,
      nextGeneration,
      activatedAt,
    ]
  );

  return loadManagedStorageSettings();
}

export function getManagedStorageRuntimeOverride(): {
  primaryProvider: ManagedStorageProvider;
  backupProvider: ManagedStorageBackupProvider;
  postgresConnectionString: string | null;
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  supabaseServiceRoleKey: string | null;
  supabaseDbUrl: string | null;
  activationGeneration: number;
} | null {
  const row = ensureSingletonRow();
  const settings = mapRow(row);
  if (!settings.activePrimaryProvider) {
    return null;
  }

  return {
    primaryProvider: settings.activePrimaryProvider,
    backupProvider: settings.activeBackupProvider,
    postgresConnectionString: settings.postgresConnectionString,
    supabaseUrl: row.supabase_url,
    supabasePublishableKey: row.supabase_publishable_key,
    supabaseServiceRoleKey: row.supabase_service_role_key,
    supabaseDbUrl: row.supabase_db_url,
    activationGeneration: settings.activationGeneration,
  };
}

export function getManagedSupabaseDraftConfig(): {
  url: string | null;
  publishableKey: string | null;
  serviceRoleKey: string | null;
  dbUrl: string | null;
} {
  const row = ensureSingletonRow();

  return {
    url: row.supabase_url,
    publishableKey: row.supabase_publishable_key,
    serviceRoleKey: row.supabase_service_role_key,
    dbUrl: row.supabase_db_url,
  };
}

export function getBootstrapAdminSessionSecret(): string | null {
  return ensureSingletonRow().admin_session_secret;
}

export function ensureBootstrapAdminSessionSecret(): string {
  const existing = getBootstrapAdminSessionSecret();
  if (existing) {
    return existing;
  }

  const generated = randomBytes(32).toString("base64url");
  touchUpdate(
    `
      UPDATE managed_storage_settings
      SET admin_session_secret = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [generated]
  );

  return generated;
}

export function hasManagedSupabaseBackupConfigured(): boolean {
  const settings = loadManagedStorageSettings();
  return settings.activePrimaryProvider === "postgres" && settings.activeBackupProvider === "supabase";
}
