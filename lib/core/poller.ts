/**
 * 后台轮询器
 * 在应用启动时自动初始化并持续运行
 */

import {historySnapshotStore} from "../database/history";
import {loadProviderConfigsFromDB} from "../database/config-loader";
import {runProviderChecks} from "../providers";
import {invalidateDashboardCache} from "./dashboard-data";
import {clearPingCache} from "./global-state";
import {getCheckConcurrency, getPollingIntervalMs} from "./polling-config";
import {getLastPingStartedAt, getPollerTimer, setLastPingStartedAt, setPollerTimer,} from "./global-state";
import {startOfficialStatusPoller} from "./official-status-poller";
import type {CheckResult, HealthStatus} from "../types";
import {PROVIDER_CHECK_ATTEMPT_TIMEOUT_MS, PROVIDER_CHECK_MAX_ATTEMPTS} from "../providers";

const POLL_INTERVAL_MS = getPollingIntervalMs();
const FAILURE_STATUSES: ReadonlySet<HealthStatus> = new Set([
  "failed",
  "validation_failed",
  "error",
]);
const POLLER_STARTUP_BUDGET_MS = 2 * 60_000;
const POLLER_FLUSH_BUFFER_MS = 30_000;

let activeTickBudgetMs: number | null = null;
let activeTickRunId = 0;
let activeTickController: AbortController | null = null;

function isFailureResult(result: CheckResult): boolean {
  return FAILURE_STATUSES.has(result.status);
}

function formatDuration(value: number | null): string {
  return typeof value === "number" ? `${value}ms` : "N/A";
}

function normalizeGroupName(groupName: string | null | undefined): string {
  return groupName?.trim() || "默认分组";
}

function logFullMessage(message: string): void {
  const normalizedMessage = message.replace(/\r\n/g, "\n");
  const lines = normalizedMessage.split("\n");

  for (const line of lines) {
    console.error(`[check-cx]     message: ${line}`);
  }
}

function logFailedResultsByGroup(results: CheckResult[]): void {
  const failedResults = results.filter(isFailureResult);
  if (failedResults.length === 0) {
    return;
  }

  const groupedResults = new Map<string, CheckResult[]>();
  for (const result of failedResults) {
    const groupName = normalizeGroupName(result.groupName);
    const items = groupedResults.get(groupName);
    if (items) {
      items.push(result);
      continue;
    }
    groupedResults.set(groupName, [result]);
  }

  console.error("[check-cx] ==================================================");
  console.error(
    `[check-cx] 本轮检测失败批次：共 ${failedResults.length} 条，分为 ${groupedResults.size} 组`
  );

  for (const [groupName, items] of [...groupedResults.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    console.error(`[check-cx] [${groupName}] ${items.length} 条`);

    for (const result of items.sort((left, right) => left.name.localeCompare(right.name))) {
      console.error(
        `[check-cx]   - ${result.name}(${result.type}/${result.model}) -> ${result.status} | latency=${formatDuration(
          result.latencyMs
        )} | ping=${formatDuration(result.pingLatencyMs)} | endpoint=${result.endpoint}`
      );

      const fullMessage = result.logMessage || result.message || "无";
      logFullMessage(fullMessage);
    }

    console.error("[check-cx] --------------------------------------------------");
  }

  console.error("[check-cx] ====================== 批次结束 =====================");
}

function isBuildPhase(): boolean {
  const maybeProcess = Reflect.get(globalThis, "process");
  if (!maybeProcess || typeof maybeProcess !== "object") {
    return false;
  }

  const maybeEnv = Reflect.get(maybeProcess, "env");
  if (!maybeEnv || typeof maybeEnv !== "object") {
    return false;
  }

  return Reflect.get(maybeEnv, "NEXT_PHASE") === "phase-production-build";
}

function isRecoveryTickDue(now: number): boolean {
  const lastStartedAt = getLastPingStartedAt();
  if (!lastStartedAt) {
    return true;
  }

  return now - lastStartedAt >= POLL_INTERVAL_MS;
}

function requestRecoveryTick(reason: string): void {
  if (isBuildPhase() || globalThis.__checkCxPollerRunning) {
    return;
  }

  const now = Date.now();
  if (!isRecoveryTickDue(now)) {
    return;
  }

  setLastPingStartedAt(now);
  console.log(
    `[check-cx] 检测到后台轮询空窗，立即补跑一轮（reason=${reason}）`
  );
  tick()
    .catch((error) => {
      console.error("[check-cx] 补跑轮询失败", error);
    });
}

function getTickBudgetMs(configCount: number): number {
  if (configCount <= 0) {
    return POLLER_STARTUP_BUDGET_MS;
  }

  const concurrency = getCheckConcurrency();
  const batches = Math.max(1, Math.ceil(configCount / concurrency));
  const maxSingleConfigDurationMs =
    PROVIDER_CHECK_ATTEMPT_TIMEOUT_MS * PROVIDER_CHECK_MAX_ATTEMPTS;
  return batches * maxSingleConfigDurationMs + POLLER_FLUSH_BUFFER_MS;
}

function isTickCurrent(tickRunId: number, signal: AbortSignal): boolean {
  return tickRunId === activeTickRunId && !signal.aborted;
}

function abortActiveTick(error: Error): void {
  if (!activeTickController || activeTickController.signal.aborted) {
    return;
  }

  activeTickController.abort(error);
}

function startCheckPoller(): void {
  if (isBuildPhase()) {
    return;
  }

  if (getPollerTimer()) {
    return;
  }

  const firstCheckAt = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
  console.log(
    `[check-cx] 初始化本地后台轮询器，interval=${POLL_INTERVAL_MS}ms，首次检测预计 ${firstCheckAt}`
  );
  const timer = setInterval(() => {
    tick().catch((error) => console.error("[check-cx] 定时检测失败", error));
  }, POLL_INTERVAL_MS);
  setPollerTimer(timer);

  startOfficialStatusPoller();

  requestRecoveryTick("poller-startup");
}

export function ensureCheckPoller(): void {
  startCheckPoller();
  requestRecoveryTick("ensure-check-poller");
}

/**
 * 执行一次轮询检查
 */
async function tick() {
  // 原子操作：检查并设置运行状态
  if (globalThis.__checkCxPollerRunning) {
    const lastStartedAt = getLastPingStartedAt();
    const duration = lastStartedAt ? Date.now() - lastStartedAt : null;
    if (duration !== null && activeTickBudgetMs !== null && duration > activeTickBudgetMs) {
      const staleTickError = new Error("当前轮询已过期，终止旧一轮 provider 检查");
      console.error(
        `[check-cx] 检测到上一轮轮询卡住，已强制释放运行锁（elapsed=${duration}ms, budget=${activeTickBudgetMs}ms）`
      );
      abortActiveTick(staleTickError);
      activeTickRunId += 1;
      activeTickBudgetMs = null;
      activeTickController = null;
      globalThis.__checkCxPollerRunning = false;
    } else {
      console.log(
        `[check-cx] 跳过 ping：上一轮仍在执行${
          duration !== null ? `（已耗时 ${duration}ms）` : ""
        }`
      );
      return;
    }
  }

  globalThis.__checkCxPollerRunning = true;
  activeTickRunId += 1;
  const tickRunId = activeTickRunId;
  const tickController = new AbortController();
  activeTickBudgetMs = POLLER_STARTUP_BUDGET_MS;
  activeTickController = tickController;

  setLastPingStartedAt(Date.now());
  try {
    const allConfigs = await loadProviderConfigsFromDB();
    if (!isTickCurrent(tickRunId, tickController.signal)) {
      return;
    }

    // 过滤掉维护中的配置
    const configs = allConfigs.filter((cfg) => !cfg.is_maintenance);
    activeTickBudgetMs = getTickBudgetMs(configs.length);

    if (configs.length === 0) {
      return;
    }

    const results = await runProviderChecks(configs, {signal: tickController.signal});
    if (!isTickCurrent(tickRunId, tickController.signal)) {
      console.warn("[check-cx] 已丢弃过期轮询结果，避免写入重复历史");
      return;
    }

    await historySnapshotStore.append(results);
    if (!isTickCurrent(tickRunId, tickController.signal)) {
      console.warn("[check-cx] 旧轮询已在写入后过期，跳过后续缓存刷新");
      return;
    }

    clearPingCache();
    invalidateDashboardCache();
    console.log(
      `[check-cx] 后台轮询完成：写入 ${results.length} 条检测结果，时间 ${new Date().toISOString()}`
    );
    logFailedResultsByGroup(results);
  } catch (error) {
    if (tickController.signal.aborted) {
      const message =
        tickController.signal.reason instanceof Error
          ? tickController.signal.reason.message
          : "当前轮询已取消";
      console.warn(`[check-cx] 轮询已取消：${message}`);
      return;
    }

    console.error("[check-cx] 轮询检测失败", error);
  } finally {
    if (tickRunId === activeTickRunId) {
      activeTickBudgetMs = null;
      activeTickController = null;
      globalThis.__checkCxPollerRunning = false;
    }
  }
}

ensureCheckPoller();
