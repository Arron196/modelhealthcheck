import "server-only";

import {
  runStorageDiagnostics,
  type StorageDiagnosticsReport,
} from "@/lib/admin/storage-diagnostics";

const STORAGE_DIAGNOSTICS_REFRESH_INTERVAL_MS = 120_000;
const STORAGE_DIAGNOSTICS_POLL_INTERVAL_MS = 30_000;
const STORAGE_DIAGNOSTICS_PENDING_POLL_INTERVAL_MS = 5_000;
const STORAGE_DIAGNOSTICS_FORCE_GAP_MS = 15_000;

interface StorageDiagnosticsCacheEntry {
  report: StorageDiagnosticsReport | null;
  refreshedAt: number;
  lastStartedAt: number;
  inflight: Promise<void> | null;
}

declare global {
  var __CHECK_CX_STORAGE_DIAGNOSTICS_CACHE__:
    | StorageDiagnosticsCacheEntry
    | undefined;
}

export interface StorageDiagnosticsSnapshot {
  report: StorageDiagnosticsReport | null;
  refreshing: boolean;
  refreshedAt: string | null;
  lastStartedAt: string | null;
  stale: boolean;
  refreshIntervalMs: number;
  pollIntervalMs: number;
  pendingPollIntervalMs: number;
  minForceRefreshGapMs: number;
}

function getCacheEntry(): StorageDiagnosticsCacheEntry {
  if (!globalThis.__CHECK_CX_STORAGE_DIAGNOSTICS_CACHE__) {
    globalThis.__CHECK_CX_STORAGE_DIAGNOSTICS_CACHE__ = {
      report: null,
      refreshedAt: 0,
      lastStartedAt: 0,
      inflight: null,
    };
  }

  return globalThis.__CHECK_CX_STORAGE_DIAGNOSTICS_CACHE__;
}

function isSnapshotStale(entry: StorageDiagnosticsCacheEntry, now: number): boolean {
  return !entry.report || now - entry.refreshedAt >= STORAGE_DIAGNOSTICS_REFRESH_INTERVAL_MS;
}

function canForceRefresh(entry: StorageDiagnosticsCacheEntry, now: number): boolean {
  return now - entry.lastStartedAt >= STORAGE_DIAGNOSTICS_FORCE_GAP_MS;
}

function startRefresh(entry: StorageDiagnosticsCacheEntry): void {
  if (entry.inflight) {
    return;
  }

  entry.lastStartedAt = Date.now();
  entry.inflight = runStorageDiagnostics()
    .then((report) => {
      entry.report = report;
      entry.refreshedAt = Date.now();
    })
    .finally(() => {
      entry.inflight = null;
    });
}

export function getStorageDiagnosticsSnapshot(input?: {
  force?: boolean;
  triggerRefresh?: boolean;
}): StorageDiagnosticsSnapshot {
  const entry = getCacheEntry();
  const now = Date.now();
  const shouldForce = input?.force === true;
  const shouldTrigger = input?.triggerRefresh === true;

  if (shouldTrigger) {
    if (shouldForce) {
      if (canForceRefresh(entry, now)) {
        startRefresh(entry);
      }
    } else if (isSnapshotStale(entry, now)) {
      startRefresh(entry);
    }
  }

  return {
    report: entry.report,
    refreshing: Boolean(entry.inflight),
    refreshedAt: entry.refreshedAt ? new Date(entry.refreshedAt).toISOString() : null,
    lastStartedAt: entry.lastStartedAt ? new Date(entry.lastStartedAt).toISOString() : null,
    stale: isSnapshotStale(entry, now),
    refreshIntervalMs: STORAGE_DIAGNOSTICS_REFRESH_INTERVAL_MS,
    pollIntervalMs: STORAGE_DIAGNOSTICS_POLL_INTERVAL_MS,
    pendingPollIntervalMs: STORAGE_DIAGNOSTICS_PENDING_POLL_INTERVAL_MS,
    minForceRefreshGapMs: STORAGE_DIAGNOSTICS_FORCE_GAP_MS,
  };
}

export function invalidateStorageDiagnosticsCache(): void {
  const entry = getCacheEntry();
  entry.report = null;
  entry.refreshedAt = 0;
}
