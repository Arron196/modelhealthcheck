import "server-only";
import { getPollingIntervalMs } from "@/lib/core/polling-config";
import { getControlPlaneStorage } from "@/lib/storage/resolver";
import type { GroupInfoRow } from "@/lib/types/database";

interface GroupInfoCache {
  data: GroupInfoRow[];
  lastFetchedAt: number;
}

interface GroupInfoCacheMetrics {
  hits: number;
  misses: number;
}

const cache: GroupInfoCache = {
  data: [],
  lastFetchedAt: 0,
};

const metrics: GroupInfoCacheMetrics = {
  hits: 0,
  misses: 0,
};

export function invalidateGroupInfoCache(): void {
  cache.data = [];
  cache.lastFetchedAt = 0;
}

export function getGroupInfoCacheMetrics(): GroupInfoCacheMetrics {
  return { ...metrics };
}

export function resetGroupInfoCacheMetrics(): void {
  metrics.hits = 0;
  metrics.misses = 0;
}

/**
 * 加载所有分组信息
 */
export async function loadGroupInfos(options?: {
  forceRefresh?: boolean;
}): Promise<GroupInfoRow[]> {
  const now = Date.now();
  const ttl = getPollingIntervalMs();
  if (!options?.forceRefresh && now - cache.lastFetchedAt < ttl) {
    metrics.hits += 1;
    return cache.data;
  }
  metrics.misses += 1;

  try {
    const storage = await getControlPlaneStorage();
    const rows = await storage.groups.list();
    cache.data = rows;
    cache.lastFetchedAt = now;
    return rows;
  } catch (error) {
    console.error("Failed to load group info:", error);
    return [];
  }
}

/**
 * 获取指定分组的信息
 */
export async function getGroupInfo(groupName: string): Promise<GroupInfoRow | null> {
  const infos = await loadGroupInfos();
  const found = infos.find((info) => info.group_name === groupName);
  return found ?? null;
}
