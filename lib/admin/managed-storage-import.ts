import "server-only";

import {createHash} from "node:crypto";

import {createSupabaseControlPlaneStorage} from "@/lib/storage/supabase";
import type {ControlPlaneStorage, StoredCheckConfigRow} from "@/lib/storage/types";
import {createPostgresControlPlaneStorage} from "@/lib/storage/postgres";
import type {HistorySnapshotRow} from "@/lib/types/database";
import {SITE_SETTINGS_SINGLETON_KEY} from "@/lib/types/site-settings";

import type {
  ManagedStorageImportSourceProvider,
  ManagedStorageImportSummary,
  ManagedStorageProvider,
} from "@/lib/storage/bootstrap-store";

interface ControlPlaneSnapshot {
  adminUsers: Awaited<ReturnType<ControlPlaneStorage["adminUsers"]["list"]>>;
  siteSettings: Awaited<ReturnType<ControlPlaneStorage["siteSettings"]["getSingleton"]>>;
  checkConfigs: StoredCheckConfigRow[];
  historyRows: HistorySnapshotRow[];
  requestTemplates: Awaited<ReturnType<ControlPlaneStorage["requestTemplates"]["list"]>>;
  groups: Awaited<ReturnType<ControlPlaneStorage["groups"]["list"]>>;
  notifications: Awaited<ReturnType<ControlPlaneStorage["notifications"]["list"]>>;
}

interface ManagedImportVerificationResult {
  sourceFingerprint: string;
  targetFingerprint: string;
  sourceMatchesImport: boolean;
  targetMatchesImport: boolean;
}

async function collectSnapshot(storage: ControlPlaneStorage): Promise<ControlPlaneSnapshot> {
  await storage.ensureReady();
  const [adminUsers, siteSettings, checkConfigs, requestTemplates, groups, notifications] = await Promise.all([
    storage.adminUsers.list(),
    storage.siteSettings.getSingleton(SITE_SETTINGS_SINGLETON_KEY),
    storage.checkConfigs.list(),
    storage.requestTemplates.list(),
    storage.groups.list(),
    storage.notifications.list(),
  ]);
  const configIds = checkConfigs.map((row) => row.id);
  const historyRows =
    configIds.length > 0
      ? await storage.runtime.history.fetchRows({
          allowedIds: configIds,
          limitPerConfig: null,
        })
      : [];

  return {
    adminUsers,
    siteSettings,
    checkConfigs,
    historyRows,
    requestTemplates,
    groups,
    notifications,
  };
}

async function syncCollection<T extends {id: string}>(input: {
  sourceRows: T[];
  targetRows: T[];
  upsert: (row: T) => Promise<void>;
  remove: (id: string) => Promise<void>;
}): Promise<void> {
  const sourceIds = new Set(input.sourceRows.map((row) => row.id));
  for (const row of input.sourceRows) {
    await input.upsert(row);
  }

  for (const row of input.targetRows) {
    if (!sourceIds.has(row.id)) {
      await input.remove(row.id);
    }
  }
}

function sortById<T extends {id: string}>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function stableSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortKeys);
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right, "en")
    );

    return Object.fromEntries(entries.map(([key, entryValue]) => [key, stableSortKeys(entryValue)]));
  }

  return value;
}

function sortHistoryRows(rows: HistorySnapshotRow[]): HistorySnapshotRow[] {
  return [...rows].sort((left, right) => {
    return (
      left.config_id.localeCompare(right.config_id, "en") ||
      left.checked_at.localeCompare(right.checked_at, "en") ||
      left.status.localeCompare(right.status, "en") ||
      (left.latency_ms ?? -1) - (right.latency_ms ?? -1) ||
      (left.ping_latency_ms ?? -1) - (right.ping_latency_ms ?? -1) ||
      (left.message ?? "").localeCompare(right.message ?? "", "en")
    );
  });
}

function createSnapshotFingerprint(snapshot: ControlPlaneSnapshot): string {
  const payload = stableSortKeys({
    adminUsers: sortById(snapshot.adminUsers).map((row) => ({
      id: row.id,
      username: row.username,
      password_hash: row.password_hash,
      last_login_at: row.last_login_at ?? null,
    })),
    siteSettings: snapshot.siteSettings
      ? {
          singleton_key: snapshot.siteSettings.singleton_key,
          site_name: snapshot.siteSettings.site_name,
          site_description: snapshot.siteSettings.site_description,
          hero_badge: snapshot.siteSettings.hero_badge,
          hero_title_primary: snapshot.siteSettings.hero_title_primary,
          hero_title_secondary: snapshot.siteSettings.hero_title_secondary,
          hero_description: snapshot.siteSettings.hero_description,
          footer_brand: snapshot.siteSettings.footer_brand,
          admin_console_title: snapshot.siteSettings.admin_console_title,
          admin_console_description: snapshot.siteSettings.admin_console_description,
        }
      : null,
    checkConfigs: sortById(snapshot.checkConfigs).map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      model: row.model,
      endpoint: row.endpoint,
      api_key: row.api_key,
      enabled: row.enabled,
      is_maintenance: row.is_maintenance,
      template_id: row.template_id ?? null,
      request_header: row.request_header ?? null,
      metadata: row.metadata ?? null,
      group_name: row.group_name ?? null,
    })),
    historyRows: sortHistoryRows(snapshot.historyRows).map((row) => ({
      config_id: row.config_id,
      status: row.status,
      latency_ms: row.latency_ms,
      ping_latency_ms: row.ping_latency_ms,
      checked_at: row.checked_at,
      message: row.message ?? null,
    })),
    requestTemplates: sortById(snapshot.requestTemplates).map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      request_header: row.request_header ?? null,
      metadata: row.metadata ?? null,
    })),
    groups: sortById(snapshot.groups).map((row) => ({
      id: row.id,
      group_name: row.group_name,
      website_url: row.website_url ?? null,
      tags: row.tags ?? null,
    })),
    notifications: sortById(snapshot.notifications).map((row) => ({
      id: row.id,
      message: row.message,
      is_active: row.is_active,
      level: row.level,
    })),
  });

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function createTargetStorage(input: {
  targetProvider: ManagedStorageProvider;
  postgresConnectionString: string | null;
}): ControlPlaneStorage {
  return input.targetProvider === "postgres"
    ? createPostgresControlPlaneStorage(
        input.postgresConnectionString ??
          (() => {
            throw new Error("缺少 PostgreSQL 连接串，无法导入控制面数据");
          })()
      )
    : createSupabaseControlPlaneStorage({allowDraft: true});
}

export async function verifyManagedStorageImport(input: {
  sourceStorage: ControlPlaneStorage;
  targetProvider: ManagedStorageProvider;
  postgresConnectionString: string | null;
  summary: ManagedStorageImportSummary;
}): Promise<ManagedImportVerificationResult> {
  const targetStorage = createTargetStorage({
    targetProvider: input.targetProvider,
    postgresConnectionString: input.postgresConnectionString,
  });
  const [sourceSnapshot, targetSnapshot] = await Promise.all([
    collectSnapshot(input.sourceStorage),
    collectSnapshot(targetStorage),
  ]);

  const sourceFingerprint = createSnapshotFingerprint(sourceSnapshot);
  const targetFingerprint = createSnapshotFingerprint(targetSnapshot);

  return {
    sourceFingerprint,
    targetFingerprint,
    sourceMatchesImport: sourceFingerprint === input.summary.sourceFingerprint,
    targetMatchesImport: targetFingerprint === input.summary.targetFingerprint,
  };
}

export async function importControlPlaneToTarget(input: {
  sourceStorage: ControlPlaneStorage;
  targetProvider: ManagedStorageProvider;
  postgresConnectionString: string | null;
}): Promise<ManagedStorageImportSummary> {
  const targetStorage = createTargetStorage({
    targetProvider: input.targetProvider,
    postgresConnectionString: input.postgresConnectionString,
  });

  const sourceSnapshot = await collectSnapshot(input.sourceStorage);
  const targetSnapshot = await collectSnapshot(targetStorage);
  const sourceFingerprint = createSnapshotFingerprint(sourceSnapshot);

  if (sourceSnapshot.siteSettings) {
    await targetStorage.siteSettings.upsert(sourceSnapshot.siteSettings);
  }

  await targetStorage.adminUsers.replaceAll(sourceSnapshot.adminUsers);

  await syncCollection({
    sourceRows: sourceSnapshot.requestTemplates,
    targetRows: targetSnapshot.requestTemplates,
    upsert: (row) => targetStorage.requestTemplates.upsert(row),
    remove: (id) => targetStorage.requestTemplates.delete(id),
  });

  await syncCollection({
    sourceRows: sourceSnapshot.groups,
    targetRows: targetSnapshot.groups,
    upsert: (row) => targetStorage.groups.upsert(row),
    remove: (id) => targetStorage.groups.delete(id),
  });

  await syncCollection({
    sourceRows: sourceSnapshot.notifications,
    targetRows: targetSnapshot.notifications,
    upsert: (row) => targetStorage.notifications.upsert(row),
    remove: (id) => targetStorage.notifications.delete(id),
  });

  await syncCollection({
    sourceRows: sourceSnapshot.checkConfigs,
    targetRows: targetSnapshot.checkConfigs,
    upsert: (row) => targetStorage.checkConfigs.upsert(row),
    remove: (id) => targetStorage.checkConfigs.delete(id),
  });

  await targetStorage.runtime.history.replaceForConfigs({
    configIds: sourceSnapshot.checkConfigs.map((row) => row.id),
    rows: sourceSnapshot.historyRows,
  });

  const verifiedTargetSnapshot = await collectSnapshot(targetStorage);
  const targetFingerprint = createSnapshotFingerprint(verifiedTargetSnapshot);
  if (targetFingerprint !== sourceFingerprint) {
    throw new Error("目标后端在导入后与源控制面快照不一致，请重新导入后再尝试切换");
  }

  return {
    importedAt: new Date().toISOString(),
    sourceProvider: input.sourceStorage.provider as ManagedStorageImportSourceProvider,
    targetProvider: input.targetProvider,
    sourceFingerprint,
    targetFingerprint,
    counts: {
      adminUsers: sourceSnapshot.adminUsers.length,
      checkConfigs: sourceSnapshot.checkConfigs.length,
      historyRows: sourceSnapshot.historyRows.length,
      requestTemplates: sourceSnapshot.requestTemplates.length,
      groups: sourceSnapshot.groups.length,
      notifications: sourceSnapshot.notifications.length,
      hasSiteSettings: Boolean(sourceSnapshot.siteSettings),
    },
  };
}
