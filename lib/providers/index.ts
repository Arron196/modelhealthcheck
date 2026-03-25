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
const TRANSIENT_FAILURE_PATTERN =
  /request was aborted\.?|timeout|请求超时|No output generated|回复为空|server_error|temporarily unavailable|overloaded/i;

async function runWithHardTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} 请求超时（>${timeoutMs}ms）`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function shouldRetryTransientFailure(...messages: Array<string | undefined>): boolean {
  const combined = messages.filter(Boolean).join("\n");
  if (!combined) {
    return false;
  }
  return TRANSIENT_FAILURE_PATTERN.test(combined);
}

async function checkWithRetry(config: ProviderConfig): Promise<CheckResult> {
  for (let attempt = 0; attempt <= MAX_REQUEST_ABORT_RETRIES; attempt += 1) {
    try {
      const result = await runWithHardTimeout(
        () => checkWithAiSdk(config),
        PROVIDER_CHECK_ATTEMPT_TIMEOUT_MS,
        `${config.name} 第 ${attempt + 1} 次检测`
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
  configs: ProviderConfig[]
): Promise<CheckResult[]> {
  if (configs.length === 0) {
    return [];
  }

  const limit = pLimit(getCheckConcurrency());
  const results = await Promise.all(
    configs.map((config) => limit(() => checkWithRetry(config)))
  );

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// 导出统一检查函数
export { checkWithAiSdk } from "./ai-sdk-check";
