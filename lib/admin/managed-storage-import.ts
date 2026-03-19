import "server-only";

import {createSupabaseControlPlaneStorage} from "@/lib/storage/supabase";
import type {ControlPlaneStorage, StoredCheckConfigRow} from "@/lib/storage/types";
import {createPostgresControlPlaneStorage} from "@/lib/storage/postgres";
import {SITE_SETTINGS_SINGLETON_KEY} from "@/lib/types/site-settings";

import type {ManagedStorageImportSummary, ManagedStorageProvider} from "@/lib/storage/bootstrap-store";

interface ControlPlaneSnapshot {
  adminUsers: Awaited<ReturnType<ControlPlaneStorage["adminUsers"]["list"]>>;
  siteSettings: Awaited<ReturnType<ControlPlaneStorage["siteSettings"]["getSingleton"]>>;
  checkConfigs: StoredCheckConfigRow[];
  requestTemplates: Awaited<ReturnType<ControlPlaneStorage["requestTemplates"]["list"]>>;
  groups: Awaited<ReturnType<ControlPlaneStorage["groups"]["list"]>>;
  notifications: Awaited<ReturnType<ControlPlaneStorage["notifications"]["list"]>>;
}

async function collectSnapshot(storage: ControlPlaneStorage): Promise<ControlPlaneSnapshot> {
  await storage.ensureReady();
  const [adminUsers, siteSettings, checkConfigs, requestTemplates, groups, notifications] =
    await Promise.all([
      storage.adminUsers.list(),
      storage.siteSettings.getSingleton(SITE_SETTINGS_SINGLETON_KEY),
      storage.checkConfigs.list(),
      storage.requestTemplates.list(),
      storage.groups.list(),
      storage.notifications.list(),
    ]);

  return {
    adminUsers,
    siteSettings,
    checkConfigs,
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

export async function importControlPlaneToTarget(input: {
  sourceStorage: ControlPlaneStorage;
  targetProvider: ManagedStorageProvider;
  postgresConnectionString: string | null;
}): Promise<ManagedStorageImportSummary> {
  const targetStorage =
    input.targetProvider === "postgres"
      ? createPostgresControlPlaneStorage(
          input.postgresConnectionString ??
            (() => {
              throw new Error("缺少 PostgreSQL 连接串，无法导入控制面数据");
            })()
        )
      : createSupabaseControlPlaneStorage();

  const sourceSnapshot = await collectSnapshot(input.sourceStorage);
  const targetSnapshot = await collectSnapshot(targetStorage);

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

  return {
    importedAt: new Date().toISOString(),
    sourceProvider: input.sourceStorage.provider as ManagedStorageProvider,
    targetProvider: input.targetProvider,
    counts: {
      adminUsers: sourceSnapshot.adminUsers.length,
      checkConfigs: sourceSnapshot.checkConfigs.length,
      requestTemplates: sourceSnapshot.requestTemplates.length,
      groups: sourceSnapshot.groups.length,
      notifications: sourceSnapshot.notifications.length,
      hasSiteSettings: Boolean(sourceSnapshot.siteSettings),
    },
  };
}
