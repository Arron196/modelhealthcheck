/**
 * 历史记录管理模块
 */

import "server-only";
import {getControlPlaneStorage} from "@/lib/storage/resolver";
import type {RuntimeHistoryQueryOptions} from "@/lib/storage/types";
import type {HistorySnapshotRow} from "@/lib/types/database";
import type {CheckResult, HistorySnapshot} from "../types";
import {logError} from "../utils";

/**
 * 每个 Provider 最多保留的历史记录数
 */
export const MAX_POINTS_PER_PROVIDER = 60;

const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 365;

export const HISTORY_RETENTION_DAYS = (() => {
  const raw = Number(process.env.HISTORY_RETENTION_DAYS);
  if (Number.isFinite(raw)) {
    return Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, raw));
  }
  return DEFAULT_RETENTION_DAYS;
})();

export type HistoryQueryOptions = RuntimeHistoryQueryOptions;

/**
 * SnapshotStore 负责与数据库交互，提供统一的读/写/清理接口
 */
class SnapshotStore {
  async fetch(options?: HistoryQueryOptions): Promise<HistorySnapshot> {
    const normalizedIds = normalizeAllowedIds(options?.allowedIds);
    if (Array.isArray(normalizedIds) && normalizedIds.length === 0) {
      return {};
    }

    try {
      const storage = await getControlPlaneStorage();
      const limitPerConfig = options?.limitPerConfig ?? MAX_POINTS_PER_PROVIDER;
      const rows = await storage.runtime.history.fetchRows({
        allowedIds: normalizedIds,
        limitPerConfig,
      });

      return mapRowsToSnapshot(rows, limitPerConfig);
    } catch (error) {
      logError("获取历史快照失败", error);
      return {};
    }
  }

  async append(results: CheckResult[]): Promise<void> {
    if (results.length === 0) {
      return;
    }

    try {
      const storage = await getControlPlaneStorage();
      await storage.runtime.history.append(results);
      await storage.runtime.history.prune(HISTORY_RETENTION_DAYS);
    } catch (error) {
      logError("写入历史记录失败", error);
      return;
    }
  }

  async prune(retentionDays: number = HISTORY_RETENTION_DAYS): Promise<void> {
    try {
      const storage = await getControlPlaneStorage();
      await storage.runtime.history.prune(retentionDays);
    } catch (error) {
      logError("清理历史记录失败", error);
    }
  }
}

export const historySnapshotStore = new SnapshotStore();

/**
 * 兼容旧接口：读取全部历史快照
 */
export async function loadHistory(
  options?: HistoryQueryOptions
): Promise<HistorySnapshot> {
  return historySnapshotStore.fetch(options);
}

/**
 * 兼容旧接口：写入并返回最新快照
 */
export async function appendHistory(
  results: CheckResult[]
): Promise<HistorySnapshot> {
  await historySnapshotStore.append(results);
  return historySnapshotStore.fetch();
}

function normalizeAllowedIds(
  ids?: Iterable<string> | null
): string[] | null {
  if (!ids) {
    return null;
  }
  const array = Array.from(ids).filter(Boolean);
  return array.length > 0 ? array : [];
}

function mapRowsToSnapshot(
  rows: HistorySnapshotRow[] | null,
  limitPerConfig: number = MAX_POINTS_PER_PROVIDER
): HistorySnapshot {
  if (!rows || rows.length === 0) {
    return {};
  }

  const history: HistorySnapshot = {};
  for (const row of rows) {
    const result: CheckResult = {
      id: row.config_id,
      name: row.name,
      type: row.type as CheckResult["type"],
      endpoint: row.endpoint ?? "",
      model: row.model,
      status: row.status as CheckResult["status"],
      latencyMs: row.latency_ms,
      pingLatencyMs: row.ping_latency_ms,
      checkedAt: row.checked_at,
      message: row.message ?? "",
      groupName: row.group_name,
    };

    if (!history[result.id]) {
      history[result.id] = [];
    }
    history[result.id].push(result);
  }

  for (const key of Object.keys(history)) {
    history[key] = history[key]
      .sort(
        (a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
      )
      .slice(0, limitPerConfig);
  }

  return history;
}


