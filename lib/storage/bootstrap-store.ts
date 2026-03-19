import "server-only";

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

export interface ManagedStorageImportSummary {
  importedAt: string;
  sourceProvider: ManagedStorageProvider;
  targetProvider: ManagedStorageProvider;
  counts: {
    adminUsers: number;
    checkConfigs: number;
    requestTemplates: number;
    groups: number;
    notifications: number;
    hasSiteSettings: boolean;
  };
}

export interface ManagedStorageSettings {
  postgresConnectionString: string | null;
  postgresConnectionMasked: string | null;
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
  postgres_connection_string: string | null;
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
      postgres_connection_string text,
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

  bootstrapDbCache = {filePath, db};
  return db;
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
    postgresConnectionString: row.postgres_connection_string,
    postgresConnectionMasked: maskConnectionString(row.postgres_connection_string),
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
  draftPrimaryProvider: ManagedStorageProvider;
  draftBackupProvider: ManagedStorageBackupProvider;
}): ManagedStorageSettings {
  const current = loadManagedStorageSettings();
  const nextConnectionString = input.postgresConnectionString.trim() || current.postgresConnectionString;
  const shouldResetReadiness =
    nextConnectionString !== current.postgresConnectionString ||
    input.draftPrimaryProvider !== current.draftPrimaryProvider ||
    input.draftBackupProvider !== current.draftBackupProvider;
  touchUpdate(
    `
      UPDATE managed_storage_settings
      SET postgres_connection_string = ?,
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
  activationGeneration: number;
} | null {
  const settings = loadManagedStorageSettings();
  if (!settings.activePrimaryProvider) {
    return null;
  }

  return {
    primaryProvider: settings.activePrimaryProvider,
    backupProvider: settings.activeBackupProvider,
    postgresConnectionString: settings.postgresConnectionString,
    activationGeneration: settings.activationGeneration,
  };
}

export function hasManagedSupabaseBackupConfigured(): boolean {
  const settings = loadManagedStorageSettings();
  return settings.activePrimaryProvider === "postgres" && settings.activeBackupProvider === "supabase";
}
