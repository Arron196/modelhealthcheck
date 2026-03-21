/**
 * 数据库配置加载模块
 */

import "server-only";
import {getPollingIntervalMs} from "../core/polling-config";
import type {CheckConfigRow, ProviderConfig, ProviderType} from "../types";
import type {CheckRequestTemplateRow} from "../types/database";
import {getControlPlaneStorage} from "@/lib/storage/resolver";
import {logError} from "../utils";

interface ConfigCache {
  data: ProviderConfig[];
  lastFetchedAt: number;
}

interface ConfigCacheMetrics {
  hits: number;
  misses: number;
}

type JsonRecord = Record<string, unknown>;
type TemplateProjection = Pick<CheckRequestTemplateRow, "type" | "request_header" | "metadata">;
type ConfigRowWithTemplate = Pick<
  CheckConfigRow,
  "id" | "name" | "type" | "model" | "endpoint" | "api_key" | "is_maintenance" | "template_id" | "request_header" | "metadata" | "group_name"
>;

const cache: ConfigCache = {
  data: [],
  lastFetchedAt: 0,
};

const metrics: ConfigCacheMetrics = {
  hits: 0,
  misses: 0,
};

export function invalidateConfigCache(): void {
  cache.data = [];
  cache.lastFetchedAt = 0;
}

export function getConfigCacheMetrics(): ConfigCacheMetrics {
  return { ...metrics };
}

export function resetConfigCacheMetrics(): void {
  metrics.hits = 0;
  metrics.misses = 0;
}

function normalizeJsonRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function mergeTemplateAndConfig(templateValue: unknown, configValue: unknown): JsonRecord | null {
  const templateRecord = normalizeJsonRecord(templateValue);
  const configRecord = normalizeJsonRecord(configValue);

  if (!templateRecord && !configRecord) {
    return null;
  }

  return {
    ...(templateRecord ?? {}),
    ...(configRecord ?? {}),
  };
}

function getTemplate(
  row: ConfigRowWithTemplate,
  templateMap: ReadonlyMap<string, TemplateProjection>
): TemplateProjection | null {
  if (!row.template_id) {
    return null;
  }

  const template = templateMap.get(row.template_id);
  if (!template || template.type !== row.type) {
    return null;
  }

  return template;
}

/**
 * 从数据库加载启用的 Provider 配置
 * @returns Provider 配置列表
 */
export async function loadProviderConfigsFromDB(options?: {
  forceRefresh?: boolean;
}): Promise<ProviderConfig[]> {
  try {
    const now = Date.now();
    const ttl = getPollingIntervalMs();
    if (!options?.forceRefresh && now - cache.lastFetchedAt < ttl) {
      metrics.hits += 1;
      return cache.data;
    }
    metrics.misses += 1;

    const storage = await getControlPlaneStorage();
    const templatesPromise = storage.requestTemplates.list().catch((error) => {
      logError("加载请求模板时发生异常", error);
      return [] as CheckRequestTemplateRow[];
    });

    const [data, templates] = await Promise.all([
      storage.checkConfigs.list({enabledOnly: true}),
      templatesPromise,
    ]);

    if (data.length === 0) {
      console.warn("[check-cx] 数据库中没有找到启用的配置");
      cache.data = [];
      cache.lastFetchedAt = now;
      return [];
    }

    const templateMap = new Map<string, TemplateProjection>(
      templates.map((template) => [
        template.id,
        {
          type: template.type,
          request_header: template.request_header,
          metadata: template.metadata,
        },
      ])
    );

    const configs: ProviderConfig[] = data.map(
      (row: ConfigRowWithTemplate) => {
        const template = getTemplate(row, templateMap);
        const mergedRequestHeaders = mergeTemplateAndConfig(template?.request_header, row.request_header) as Record<string, string> | null;
        const mergedMetadata = mergeTemplateAndConfig(template?.metadata, row.metadata);

        return {
          id: row.id,
          name: row.name,
          type: row.type as ProviderType,
          endpoint: row.endpoint,
          model: row.model,
          apiKey: row.api_key,
          is_maintenance: row.is_maintenance,
          requestHeaders: mergedRequestHeaders,
          metadata: mergedMetadata,
          groupName: row.group_name || null,
        };
      }
    );

    cache.data = configs;
    cache.lastFetchedAt = now;
    return configs;
  } catch (error) {
    logError("加载配置时发生异常", error);
    return [];
  }
}
