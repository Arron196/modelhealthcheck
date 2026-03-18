import "server-only";

import path from "node:path";

import {createPostgresControlPlaneStorage} from "./postgres";
import {createSqliteControlPlaneStorage} from "./sqlite";
import {createSupabaseControlPlaneStorage} from "./supabase";
import type {ControlPlaneStorage, DatabaseProvider, StorageCapabilities} from "./types";

const DEFAULT_SQLITE_RELATIVE_PATH = path.join(".sisyphus", "local-data", "app.db");

export interface DirectPostgresConnectionState {
  connectionString: string | null;
  source: string | null;
}

export interface ResolvedDatabaseBackend {
  provider: DatabaseProvider;
  capabilities: StorageCapabilities;
  reason: string;
  postgresConnectionString: string | null;
  postgresConnectionSource: string | null;
  sqliteFilePath: string;
}

let storagePromise: Promise<ControlPlaneStorage> | null = null;
let backendCache: ResolvedDatabaseBackend | null = null;

function normalizeEnv(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isDatabaseProvider(value: string | null): value is DatabaseProvider {
  return value === "supabase" || value === "postgres" || value === "sqlite";
}

function hasSupabaseStorageConfig(): boolean {
  return Boolean(
    normalizeEnv(process.env.SUPABASE_URL) && normalizeEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

export function getDirectPostgresConnectionState(): DirectPostgresConnectionState {
  const candidates = [
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["POSTGRES_URL", process.env.POSTGRES_URL],
    ["POSTGRES_PRISMA_URL", process.env.POSTGRES_PRISMA_URL],
    ["SUPABASE_DB_URL", process.env.SUPABASE_DB_URL],
  ] as const;

  for (const [source, rawValue] of candidates) {
    const connectionString = normalizeEnv(rawValue);
    if (connectionString) {
      return {
        connectionString,
        source,
      };
    }
  }

  return {
    connectionString: null,
    source: null,
  };
}

function getSqliteFilePath(): string {
  const configured = normalizeEnv(process.env.SQLITE_DATABASE_PATH);
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }

  return path.resolve(process.cwd(), DEFAULT_SQLITE_RELATIVE_PATH);
}

function getCapabilities(provider: DatabaseProvider): StorageCapabilities {
  if (provider === "supabase") {
    return {
      provider,
      adminAuth: true,
      siteSettings: true,
      controlPlaneCrud: true,
      requestTemplates: true,
      groups: true,
      notifications: true,
      historySnapshots: true,
      availabilityStats: true,
      pollerLease: true,
      runtimeMigrations: true,
      supabaseDiagnostics: true,
      autoProvisionControlPlane: false,
    };
  }

  return {
    provider,
    adminAuth: true,
    siteSettings: true,
    controlPlaneCrud: true,
    requestTemplates: true,
    groups: true,
    notifications: true,
    historySnapshots: false,
    availabilityStats: false,
    pollerLease: false,
    runtimeMigrations: false,
    supabaseDiagnostics: false,
    autoProvisionControlPlane: true,
  };
}

export function resolveDatabaseBackend(): ResolvedDatabaseBackend {
  if (backendCache) {
    return backendCache;
  }

  const explicitProvider = normalizeEnv(process.env.DATABASE_PROVIDER);
  const postgres = getDirectPostgresConnectionState();
  const sqliteFilePath = getSqliteFilePath();

  let provider: DatabaseProvider;
  let reason: string;

  if (explicitProvider) {
    if (!isDatabaseProvider(explicitProvider)) {
      throw new Error(
        "DATABASE_PROVIDER 仅支持 supabase、postgres 或 sqlite"
      );
    }

    provider = explicitProvider;
    reason = `explicit:${explicitProvider}`;
  } else if (hasSupabaseStorageConfig()) {
    provider = "supabase";
    reason = "env:supabase";
  } else if (postgres.connectionString) {
    provider = "postgres";
    reason = `env:${postgres.source}`;
  } else {
    provider = "sqlite";
    reason = "fallback:sqlite";
  }

  backendCache = {
    provider,
    capabilities: getCapabilities(provider),
    reason,
    postgresConnectionString: postgres.connectionString,
    postgresConnectionSource: postgres.source,
    sqliteFilePath,
  };

  return backendCache;
}

export function getStorageCapabilities(): StorageCapabilities {
  return resolveDatabaseBackend().capabilities;
}

export async function getControlPlaneStorage(): Promise<ControlPlaneStorage> {
  if (!storagePromise) {
    storagePromise = (async () => {
      const backend = resolveDatabaseBackend();
      const storage =
        backend.provider === "supabase"
          ? createSupabaseControlPlaneStorage()
          : backend.provider === "postgres"
            ? createPostgresControlPlaneStorage(
                backend.postgresConnectionString ??
                  (() => {
                    throw new Error(
                      "当前选择 postgres 存储，但未配置 DATABASE_URL / POSTGRES_URL / SUPABASE_DB_URL"
                    );
                  })()
              )
            : createSqliteControlPlaneStorage(backend.sqliteFilePath);

      await storage.ensureReady();
      return storage;
    })();
  }

  return storagePromise;
}
