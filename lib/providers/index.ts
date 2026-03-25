/**
 * Provider 检查统一入口
 */

import pLimit from "p-limit";
import type { CheckResult, ProviderConfig } from "../types";
import { getErrorMessage, getSanitizedErrorDetail, logError } from "../utils";
import { checkWithAiSdk } from "./ai-sdk-check";
import { getCheckConcurrency } from "../core/polling-config";

// 最多尝试 3 次：初始一次 + 2 次重试
const MAX_REQUEST_ABORT_RETRIES = 2;
export const PROVIDER_CHECK_ATTEMPT_TIMEOUT_MS = 60_000;
export const PROVIDER_CHECK_MAX_ATTEMPTS = MAX_REQUEST_ABORT_RETRIES + 1;
const ABORT_SETTLE_GRACE_MS = 2_000;
const TRANSIENT_FAILURE_PATTERN =
  /request was aborted\.?|timeout|请求超时|No output generated|回复为空|server_error|temporarily unavailable|overloaded/i;

interface ProviderCheckExecutionOptions {
  signal?: AbortSignal;
}

function normalizeAbortError(reason: unknown, fallbackMessage: string): Error {
  if (reason instanceof Error) {
    return reason;
  }

  if (typeof reason === "string" && reason.trim()) {
    return new Error(reason);
  }

  return new Error(fallbackMessage);
}

function throwIfAborted(signal: AbortSignal | undefined, fallbackMessage: string): void {
  if (!signal?.aborted) {
    return;
  }

  throw normalizeAbortError(signal.reason, fallbackMessage);
}

async function runWithHardTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
  options?: ProviderCheckExecutionOptions
): Promise<T> {
  const parentSignal = options?.signal;
  const localController = new AbortController();
  let abortFallbackId: ReturnType<typeof setTimeout> | undefined;
  let removeParentAbortListener: (() => void) | null = null;
  let scheduleAbortFallback: ((error: Error) => void) | null = null;
  const timeoutError = new Error(`${label} 请求超时（>${timeoutMs}ms）`);

  const abortFallbackPromise = new Promise<never>((_, reject) => {
    let scheduled = false;
    scheduleAbortFallback = (error) => {
      if (scheduled) {
        return;
      }

      scheduled = true;
      abortFallbackId = setTimeout(() => reject(error), ABORT_SETTLE_GRACE_MS);
    };
  });

  const abortOperation = (reason: unknown, fallbackMessage: string) => {
    const abortError = normalizeAbortError(reason, fallbackMessage);
    if (!localController.signal.aborted) {
      localController.abort(abortError);
    }
    scheduleAbortFallback?.(abortError);
    return abortError;
  };

  throwIfAborted(parentSignal, `${label} 已取消`);

  if (parentSignal) {
    const handleParentAbort = () => {
      abortOperation(parentSignal.reason, `${label} 已取消`);
    };

    parentSignal.addEventListener("abort", handleParentAbort, {once: true});
    removeParentAbortListener = () => {
      parentSignal.removeEventListener("abort", handleParentAbort);
    };
  }

  const operationPromise = operation(localController.signal);
  const timeoutId = setTimeout(() => {
    abortOperation(timeoutError, timeoutError.message);
  }, timeoutMs);

  try {
    return await Promise.race([operationPromise, abortFallbackPromise]);
  } catch (error) {
    if (localController.signal.aborted) {
      throw normalizeAbortError(localController.signal.reason ?? error, `${label} 已取消`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (abortFallbackId) {
      clearTimeout(abortFallbackId);
    }
    removeParentAbortListener?.();
  }
}

function shouldRetryTransientFailure(...messages: Array<string | undefined>): boolean {
  const combined = messages.filter(Boolean).join("\n");
  if (!combined) {
    return false;
  }
  return TRANSIENT_FAILURE_PATTERN.test(combined);
}

async function checkWithRetry(
  config: ProviderConfig,
  options?: ProviderCheckExecutionOptions
): Promise<CheckResult> {
  for (let attempt = 0; attempt <= MAX_REQUEST_ABORT_RETRIES; attempt += 1) {
    throwIfAborted(options?.signal, `${config.name} 检测已取消`);

    try {
      const result = await runWithHardTimeout(
        (attemptSignal) =>
          checkWithAiSdk(config, {
            abortSignal: attemptSignal,
            propagateAbort: true,
          }),
        PROVIDER_CHECK_ATTEMPT_TIMEOUT_MS,
        `${config.name} 第 ${attempt + 1} 次检测`,
        options
      );
      if (
        (result.status === "failed" || result.status === "error") &&
        shouldRetryTransientFailure(result.message, result.logMessage) &&
        attempt < MAX_REQUEST_ABORT_RETRIES
      ) {
        console.warn(
          `[check-cx] ${config.name} 请求异常（${result.message}），正在重试第 ${
            attempt + 2
          } 次`
        );
        continue;
      }
      return result;
    } catch (error) {
      if (options?.signal?.aborted) {
        throw normalizeAbortError(options.signal.reason ?? error, `${config.name} 检测已取消`);
      }

      const message = getErrorMessage(error);
      if (
        shouldRetryTransientFailure(message) &&
        attempt < MAX_REQUEST_ABORT_RETRIES
      ) {
        console.warn(
          `[check-cx] ${config.name} 请求异常（${message}），正在重试第 ${
            attempt + 2
          } 次`
        );
        continue;
      }

      logError(`检查 ${config.name} (${config.type}) 失败`, error);
      return {
        id: config.id,
        name: config.name,
        type: config.type,
        endpoint: config.endpoint,
        model: config.model,
        status: "error",
        latencyMs: null,
        pingLatencyMs: null,
        checkedAt: new Date().toISOString(),
        message,
        logMessage: getSanitizedErrorDetail(error),
        groupName: config.groupName || null,
      };
    }
  }

  // 理论上不会触发，这里仅为类型系统兜底
  throw new Error("Unexpected retry loop exit");
}

/**
 * 批量执行 Provider 健康检查
 * @param configs Provider 配置列表
 * @returns 检查结果列表,按名称排序
 */
export async function runProviderChecks(
  configs: ProviderConfig[],
  options?: ProviderCheckExecutionOptions
): Promise<CheckResult[]> {
  if (configs.length === 0) {
    return [];
  }

  const limit = pLimit(getCheckConcurrency());
  const results = await Promise.all(
    configs.map((config) => limit(() => checkWithRetry(config, options)))
  );

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// 导出统一检查函数
export { checkWithAiSdk } from "./ai-sdk-check";
