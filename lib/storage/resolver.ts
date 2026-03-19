import "server-only";

import path from "node:path";

import {getErrorMessage} from "@/lib/utils";

import {getManagedStorageRuntimeOverride} from "./bootstrap-store";
import {
  createPostgresControlPlaneStorage,
  resetPostgresControlPlaneStorageCache,
} from "./postgres";
import {
  createSqliteControlPlaneStorage,
  resetSqliteControlPlaneStorageCache,
} from "./sqlite";
import {createSupabaseControlPlaneStorage} from "./supabase";
import type {ControlPlaneStorage, DatabaseProvider, StorageCapabilities} from "./types";

const DEFAULT_SQLITE_RELATIVE_PATH = path.join(".sisyphus", "local-data", "app.db");

export interface DirectPostgresConnectionState {
  connectionString: string | null;
  source: string | null;
}

export interface ResolvedDatabaseBackend {
  provider: DatabaseProvider;
  backupProvider: DatabaseProvider | null;
  capabilities: StorageCapabilities;
  reason: string;
  postgresConnectionString: string | null;
  postgresConnectionSource: string | null;
  sqliteFilePath: string;
  managedActivationGeneration: number | null;
}

export interface RuntimeStorageResolution {
  preferredProvider: DatabaseProvider;
  preferredReason: string;
  activeProvider: DatabaseProvider;
  activeReason: string;
  isFailover: boolean;
  isBlocked: boolean;
  failoverError: string | null;
  postgresConnectionSource: string | null;
  sqliteFilePath: string;
}

let storagePromise: Promise<ControlPlaneStorage> | null = null;
let backendCache: ResolvedDatabaseBackend | null = null;
let runtimeResolutionCache: RuntimeStorageResolution | null = null;

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

function hasExplicitDatabaseProvider(): boolean {
  return Boolean(normalizeEnv(process.env.DATABASE_PROVIDER));
}

function hasAnyRemoteBackendConfigured(): boolean {
  const managedOverride = getManagedStorageRuntimeOverride();
  return Boolean(
    hasSupabaseStorageConfig() ||
      getDirectPostgresConnectionState().connectionString ||
      managedOverride?.postgresConnectionString
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
    historySnapshots: true,
    availabilityStats: true,
    pollerLease: false,
    runtimeMigrations: false,
    supabaseDiagnostics: false,
    autoProvisionControlPlane: true,
  };
}

function createRuntimeResolution(input: {
  preferredProvider: DatabaseProvider;
  preferredReason: string;
  activeProvider: DatabaseProvider;
  activeReason: string;
  isFailover: boolean;
  isBlocked: boolean;
  failoverError: string | null;
  postgresConnectionSource: string | null;
  sqliteFilePath: string;
}): RuntimeStorageResolution {
  return {
    preferredProvider: input.preferredProvider,
    preferredReason: input.preferredReason,
    activeProvider: input.activeProvider,
    activeReason: input.activeReason,
    isFailover: input.isFailover,
    isBlocked: input.isBlocked,
    failoverError: input.failoverError,
    postgresConnectionSource: input.postgresConnectionSource,
    sqliteFilePath: input.sqliteFilePath,
  };
}

function createBlockedInitializationError(message: string, error: unknown): Error {
  return new Error(`${message}：${getErrorMessage(error)}`);
}

export function resolveDatabaseBackend(): ResolvedDatabaseBackend {
  if (backendCache) {
    return backendCache;
  }

  const explicitProvider = normalizeEnv(process.env.DATABASE_PROVIDER);
  const postgres = getDirectPostgresConnectionState();
  const managedOverride = getManagedStorageRuntimeOverride();
  const sqliteFilePath = getSqliteFilePath();

  let provider: DatabaseProvider;
  let backupProvider: DatabaseProvider | null = null;
  let reason: string;
  let postgresConnectionString = postgres.connectionString;
  let postgresConnectionSource = postgres.source;

  if (managedOverride) {
    provider = managedOverride.primaryProvider;
    backupProvider = managedOverride.backupProvider === "none" ? null : managedOverride.backupProvider;
    reason = `managed:${managedOverride.primaryProvider}:generation:${managedOverride.activationGeneration}`;
    if (managedOverride.postgresConnectionString) {
      postgresConnectionString = managedOverride.postgresConnectionString;
      postgresConnectionSource = "managed:bootstrap";
    }
  } else if (explicitProvider) {
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
    backupProvider,
    capabilities: getCapabilities(provider),
    reason,
    postgresConnectionString,
    postgresConnectionSource,
    sqliteFilePath,
    managedActivationGeneration: managedOverride?.activationGeneration ?? null,
  };

  return backendCache;
}

export function getStorageCapabilities(): StorageCapabilities {
  if (runtimeResolutionCache) {
    return getCapabilities(runtimeResolutionCache.activeProvider);
  }

  return resolveDatabaseBackend().capabilities;
}

export function getRuntimeStorageResolution(): RuntimeStorageResolution | null {
  return runtimeResolutionCache;
}

export async function resetStorageResolverCaches(): Promise<void> {
  storagePromise = null;
  backendCache = null;
  runtimeResolutionCache = null;
  await resetPostgresControlPlaneStorageCache();
  resetSqliteControlPlaneStorageCache();
}

export async function getControlPlaneStorage(): Promise<ControlPlaneStorage> {
  if (!storagePromise) {
    storagePromise = (async () => {
      const backend = resolveDatabaseBackend();
      const primaryResolution = createRuntimeResolution({
        preferredProvider: backend.provider,
        preferredReason: backend.reason,
        activeProvider: backend.provider,
        activeReason: backend.reason,
        isFailover: false,
        isBlocked: false,
        failoverError: null,
        postgresConnectionSource: backend.postgresConnectionSource,
        sqliteFilePath: backend.sqliteFilePath,
      });

      const finalize = async (
        storage: ControlPlaneStorage,
        resolution: RuntimeStorageResolution
      ): Promise<ControlPlaneStorage> => {
        await storage.ensureReady();
        runtimeResolutionCache = resolution;
        return storage;
      };

      const failBlockedResolution = (
        resolution: RuntimeStorageResolution,
        error: unknown
      ): never => {
        runtimeResolutionCache = createRuntimeResolution({
          ...resolution,
          isBlocked: true,
          failoverError: resolution.failoverError ?? getErrorMessage(error),
        });
        throw error instanceof Error ? error : new Error(String(error));
      };

      const createPostgresStorage = (): ControlPlaneStorage =>
        createPostgresControlPlaneStorage(
          backend.postgresConnectionString ??
            (() => {
              throw new Error(
                "当前选择 postgres 存储，但未配置 DATABASE_URL / POSTGRES_URL / SUPABASE_DB_URL"
              );
            })()
        );

      const createStorageFor = (provider: DatabaseProvider): ControlPlaneStorage => {
        if (provider === "supabase") {
          return createSupabaseControlPlaneStorage();
        }
        if (provider === "postgres") {
          return createPostgresStorage();
        }
        return createSqliteControlPlaneStorage(backend.sqliteFilePath);
      };

      try {
        if (backend.reason.startsWith("managed:")) {
          const managedResolution = createRuntimeResolution({
            preferredProvider: backend.provider,
            preferredReason: backend.reason,
            activeProvider: backend.provider,
            activeReason: `managed-primary:${backend.provider}`,
            isFailover: false,
            isBlocked: false,
            failoverError: null,
            postgresConnectionSource: backend.postgresConnectionSource,
            sqliteFilePath: backend.sqliteFilePath,
          });

          try {
            return await finalize(createStorageFor(backend.provider), managedResolution);
          } catch (error) {
            failBlockedResolution(
              createRuntimeResolution({
                ...managedResolution,
                activeReason: `blocked:${backend.provider}`,
              }),
              createBlockedInitializationError(
                `托管主后端 ${backend.provider} 初始化失败；当前单主模型不会自动切到备用后端`,
                error
              )
            );
          }
        }

        if (hasExplicitDatabaseProvider()) {
          const storage = createStorageFor(backend.provider);

          try {
            return await finalize(storage, primaryResolution);
          } catch (error) {
            failBlockedResolution(primaryResolution, error);
          }
        }

        if (backend.provider === "supabase" && backend.postgresConnectionString) {
          try {
            return await finalize(createSupabaseControlPlaneStorage(), createRuntimeResolution({
              preferredProvider: "supabase",
              preferredReason: backend.reason,
              activeProvider: "supabase",
              activeReason: "primary:supabase",
              isFailover: false,
              isBlocked: false,
              failoverError: null,
              postgresConnectionSource: backend.postgresConnectionSource,
              sqliteFilePath: backend.sqliteFilePath,
            }));
          } catch (supabaseError) {
            const failoverError = getErrorMessage(supabaseError);
            const failoverResolution = createRuntimeResolution({
              preferredProvider: "supabase",
              preferredReason: backend.reason,
              activeProvider: "postgres",
              activeReason: `failover:postgres:${backend.postgresConnectionSource ?? "direct"}`,
              isFailover: true,
              isBlocked: false,
              failoverError,
              postgresConnectionSource: backend.postgresConnectionSource,
              sqliteFilePath: backend.sqliteFilePath,
            });

            try {
              return await finalize(createPostgresStorage(), failoverResolution);
            } catch (postgresError) {
              failBlockedResolution(
                createRuntimeResolution({
                  ...failoverResolution,
                  failoverError: `主后端失败：${failoverError}；Postgres 兜底也失败：${getErrorMessage(postgresError)}`,
                }),
                createBlockedInitializationError(
                  "Supabase 初始化失败，且 Postgres 兜底也不可用，当前不会自动回退到 SQLite",
                  postgresError
                )
              );
            }
          }
        }

        if (backend.provider === "supabase" && hasAnyRemoteBackendConfigured()) {
          try {
            return await finalize(createSupabaseControlPlaneStorage(), primaryResolution);
          } catch (error) {
            failBlockedResolution(
              createRuntimeResolution({
                ...primaryResolution,
                activeReason: "blocked:supabase",
              }),
              createBlockedInitializationError(
                "Supabase 初始化失败，且未配置可用的 Postgres 兜底，因此不会自动回退到 SQLite",
                error
              )
            );
          }
        }

        if (backend.provider === "postgres") {
          try {
            return await finalize(createPostgresStorage(), primaryResolution);
          } catch (error) {
            failBlockedResolution(
              createRuntimeResolution({
                ...primaryResolution,
                activeReason: "blocked:postgres",
              }),
              createBlockedInitializationError(
                "Postgres 初始化失败，当前不会自动回退到 SQLite",
                error
              )
            );
          }
        }

        return await finalize(createSqliteControlPlaneStorage(backend.sqliteFilePath), createRuntimeResolution({
          preferredProvider: "sqlite",
          preferredReason: backend.reason,
          activeProvider: "sqlite",
          activeReason: backend.reason,
          isFailover: false,
          isBlocked: false,
          failoverError: null,
          postgresConnectionSource: backend.postgresConnectionSource,
          sqliteFilePath: backend.sqliteFilePath,
        }));
      } catch (error) {
        throw error;
      }
    })().catch((error) => {
      storagePromise = null;
      throw error;
    });
  }

  return storagePromise;
}
