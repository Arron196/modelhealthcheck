import "server-only";

import type {PostgrestError} from "@supabase/supabase-js";

import {createAdminClient} from "@/lib/supabase/admin";
import {getErrorMessage} from "@/lib/utils";

import type {
  CheckConfigMutationInput,
  ControlPlaneStorage,
  GroupMutationInput,
  NotificationMutationInput,
  RequestTemplateMutationInput,
  RuntimeHistoryQueryOptions,
  SiteSettingsMutationInput,
  StorageCapabilities,
} from "./types";
import {
  createStorageId,
  getDefaultRequestTemplateRows,
  mapAdminUserRecord,
  mapAvailabilityStatsRow,
  mapCheckConfigRow,
  mapGroupInfoRow,
  mapHistorySnapshotRow,
  mapNotificationRow,
  mapRequestTemplateRow,
  mapSiteSettingsRow,
} from "./shared";

const capabilities: StorageCapabilities = {
  provider: "supabase",
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

const DEFAULT_HISTORY_LIMIT = 60;
const RPC_RECENT_HISTORY = "get_recent_check_history";
const RPC_PRUNE_HISTORY = "prune_check_history";

function wrapStorageError(action: string, error: unknown): never {
  throw new Error(`${action}失败：${getErrorMessage(error)}`);
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

export function createSupabaseControlPlaneStorage(input?: {allowDraft?: boolean}): ControlPlaneStorage {
  const allowDraft = input?.allowDraft;
  let readyPromise: Promise<void> | null = null;

  async function ensureReady(): Promise<void> {
    if (readyPromise) {
      return readyPromise;
    }

    readyPromise = (async () => {
      const client = createAdminClient({allowDraft});
      const {error} = await client
        .from("check_request_templates")
        .upsert(
          getDefaultRequestTemplateRows().map((template) => ({
            id: template.id,
            name: template.name,
            type: template.type,
            request_header: template.request_header,
            metadata: template.metadata,
          })),
          {onConflict: "id", ignoreDuplicates: true}
        );

      if (error) {
        wrapStorageError("初始化默认请求模板", error);
      }
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });

    return readyPromise;
  }

  function normalizeIds(ids?: Iterable<string> | null): string[] | null {
    if (!ids) {
      return null;
    }

    const normalized = Array.from(ids).filter(Boolean);
    return normalized.length > 0 ? normalized : [];
  }

  function isMissingFunctionError(error: PostgrestError | null): boolean {
    if (!error?.message) {
      return false;
    }

    return error.message.includes(RPC_RECENT_HISTORY) || error.message.includes(RPC_PRUNE_HISTORY);
  }

  async function fallbackFetchHistoryRows(allowedIds: string[] | null, limitPerConfig?: number | null) {
    const client = createAdminClient({allowDraft});
    let query = client
      .from("check_history")
      .select(
        `
          id,
          config_id,
          status,
          latency_ms,
          ping_latency_ms,
          checked_at,
          message,
          check_configs (
            id,
            name,
            type,
            model,
            endpoint,
            group_name
          )
        `
      )
      .order("checked_at", {ascending: false});

    if (allowedIds) {
      query = query.in("config_id", allowedIds);
    }

    if (typeof limitPerConfig === "number") {
      query = query.limit(Math.max(limitPerConfig * Math.max(allowedIds?.length ?? 1, 1), limitPerConfig));
    }

    const {data, error} = await query;
    if (error) {
      wrapStorageError("读取历史快照", error);
    }

    return ((data as Array<Record<string, unknown>> | null) ?? []).flatMap((record) => {
      const configRows = record.check_configs;
      if (!configRows || !Array.isArray(configRows) || configRows.length === 0) {
        return [];
      }

      const config = configRows[0] as Record<string, unknown>;
      return [
        mapHistorySnapshotRow({
          id: record.id,
          config_id: record.config_id,
          status: record.status,
          latency_ms: record.latency_ms,
          ping_latency_ms: record.ping_latency_ms,
          checked_at: record.checked_at,
          message: record.message,
          name: config.name,
          type: config.type,
          model: config.model,
          endpoint: config.endpoint,
          group_name: config.group_name,
        }),
      ];
    });
  }

  async function fetchHistoryRows(options?: RuntimeHistoryQueryOptions) {
    await ensureReady();

    const normalizedIds = normalizeIds(options?.allowedIds);
    if (Array.isArray(normalizedIds) && normalizedIds.length === 0) {
      return [];
    }

    const client = createAdminClient({allowDraft});
    const limitPerConfig = options?.limitPerConfig ?? DEFAULT_HISTORY_LIMIT;

    if (limitPerConfig === null) {
      return fallbackFetchHistoryRows(normalizedIds, null);
    }

    const {data, error} = await client.rpc(RPC_RECENT_HISTORY, {
      limit_per_config: limitPerConfig,
      target_config_ids: normalizedIds,
    });

    if (error) {
      if (isMissingFunctionError(error)) {
        return fallbackFetchHistoryRows(normalizedIds, limitPerConfig);
      }

      wrapStorageError("读取历史快照", error);
    }

    return ((data as Array<Record<string, unknown>> | null) ?? []).map(mapHistorySnapshotRow);
  }

  async function appendHistory(results: Array<{
    id: string;
    status: string;
    latencyMs: number | null;
    pingLatencyMs: number | null;
    checkedAt: string;
    message: string;
  }>) {
    await ensureReady();
    if (results.length === 0) {
      return;
    }

    const client = createAdminClient({allowDraft});
    const {error} = await client.from("check_history").insert(
      results.map((result) => ({
        config_id: result.id,
        status: result.status,
        latency_ms: result.latencyMs,
        ping_latency_ms: result.pingLatencyMs,
        checked_at: result.checkedAt,
        message: result.message,
      }))
    );

    if (error) {
      wrapStorageError("写入历史记录", error);
    }
  }

  async function pruneHistory(retentionDays: number) {
    await ensureReady();
    const client = createAdminClient({allowDraft});
    const {error} = await client.rpc(RPC_PRUNE_HISTORY, {
      retention_days: retentionDays,
    });

    if (!error) {
      return;
    }

    if (!isMissingFunctionError(error)) {
      wrapStorageError("清理历史记录", error);
    }

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const {error: deleteError} = await client.from("check_history").delete().lt("checked_at", cutoff);
    if (deleteError) {
      wrapStorageError("清理历史记录", deleteError);
    }
  }

  async function replaceHistoryForConfigs(input: {
    configIds: Iterable<string>;
    rows: Awaited<ReturnType<typeof fetchHistoryRows>>;
  }) {
    await ensureReady();

    const normalizedIds = normalizeIds(input.configIds);
    if (!normalizedIds || normalizedIds.length === 0) {
      return;
    }

    const client = createAdminClient({allowDraft});
    for (const batch of chunkRows(normalizedIds, 200)) {
      const {error} = await client.from("check_history").delete().in("config_id", batch);
      if (error) {
        wrapStorageError("替换历史记录", error);
      }
    }

    for (const batch of chunkRows(input.rows, 500)) {
      if (batch.length === 0) {
        continue;
      }

      const {error} = await client.from("check_history").insert(
        batch.map((row) => ({
          config_id: row.config_id,
          status: row.status,
          latency_ms: row.latency_ms,
          ping_latency_ms: row.ping_latency_ms,
          checked_at: row.checked_at,
          message: row.message,
          created_at: row.checked_at,
        }))
      );

      if (error) {
        wrapStorageError("替换历史记录", error);
      }
    }
  }

  async function listAvailabilityStats(configIds?: Iterable<string> | null) {
    await ensureReady();

    const normalizedIds = normalizeIds(configIds);
    if (Array.isArray(normalizedIds) && normalizedIds.length === 0) {
      return [];
    }

    const client = createAdminClient({allowDraft});
    let query = client
      .from("availability_stats")
      .select("config_id, period, total_checks, operational_count, availability_pct")
      .order("config_id", {ascending: true})
      .order("period", {ascending: true});

    if (normalizedIds) {
      query = query.in("config_id", normalizedIds);
    }

    const {data, error} = await query;
    if (error) {
      wrapStorageError("读取可用性统计", error);
    }

    return ((data as Array<Record<string, unknown>> | null) ?? []).map(mapAvailabilityStatsRow);
  }

  return {
    provider: "supabase",
    capabilities,
    ensureReady,
    runtime: {
      history: {
        fetchRows: fetchHistoryRows,
        append: appendHistory,
        prune: pruneHistory,
        replaceForConfigs: replaceHistoryForConfigs,
      },
      availability: {
        listStats: listAvailabilityStats,
      },
    },
    adminUsers: {
      async hasAny() {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {data, error} = await client.from("admin_users").select("id").limit(1);

        if (error) {
          wrapStorageError("读取管理员账户", error);
        }

        return Boolean(data && data.length > 0);
      },
      async list() {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {data, error} = await client
          .from("admin_users")
          .select("id, username, password_hash, last_login_at, created_at, updated_at")
          .order("username", {ascending: true});

        if (error) {
          wrapStorageError("读取管理员账户列表", error);
        }

        return ((data as Array<Record<string, unknown>> | null) ?? []).map(mapAdminUserRecord);
      },
      async findByUsername(username) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {data, error} = await client
          .from("admin_users")
          .select("id, username, password_hash, last_login_at, created_at, updated_at")
          .eq("username", username)
          .maybeSingle();

        if (error) {
          wrapStorageError("读取管理员账户", error);
        }

        return data ? mapAdminUserRecord(data as Record<string, unknown>) : null;
      },
      async create(input) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {data, error} = await client
          .from("admin_users")
          .insert({
            username: input.username,
            password_hash: input.passwordHash,
            last_login_at: input.lastLoginAt ?? null,
          })
          .select("id, username, password_hash, last_login_at, created_at, updated_at")
          .single();

        if (error) {
          wrapStorageError("创建管理员账户", error);
        }

        return mapAdminUserRecord(data as Record<string, unknown>);
      },
      async replaceAll(records) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {data: existingRows, error: existingError} = await client
          .from("admin_users")
          .select("id");

        if (existingError) {
          wrapStorageError("读取管理员账户列表", existingError);
        }

        const existingIds = ((existingRows as Array<{id: string}> | null) ?? []).map((row) => row.id);
        if (existingIds.length > 0) {
          const {error: deleteError} = await client.from("admin_users").delete().in("id", existingIds);
          if (deleteError) {
            wrapStorageError("清理管理员账户", deleteError);
          }
        }

        if (records.length === 0) {
          return;
        }

        const {error: insertError} = await client.from("admin_users").insert(
          records.map((record) => ({
            id: record.id,
            username: record.username,
            password_hash: record.password_hash,
            last_login_at: record.last_login_at ?? null,
            created_at: record.created_at ?? new Date().toISOString(),
            updated_at: record.updated_at ?? new Date().toISOString(),
          }))
        );

        if (insertError) {
          wrapStorageError("导入管理员账户", insertError);
        }
      },
      async updateLastLoginAt(id, lastLoginAt) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {error} = await client
          .from("admin_users")
          .update({last_login_at: lastLoginAt})
          .eq("id", id);

        if (error) {
          wrapStorageError("更新管理员登录时间", error);
        }
      },
    },
    siteSettings: {
      async getSingleton(singletonKey) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {data, error} = await client
          .from("site_settings")
          .select(
            "singleton_key, site_name, site_description, hero_badge, hero_title_primary, hero_title_secondary, hero_description, footer_brand, admin_console_title, admin_console_description, created_at, updated_at"
          )
          .eq("singleton_key", singletonKey)
          .maybeSingle();

        if (error) {
          wrapStorageError("读取站点设置", error);
        }

        return data ? mapSiteSettingsRow(data as Record<string, unknown>) : null;
      },
      async upsert(input: SiteSettingsMutationInput) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {error} = await client
          .from("site_settings")
          .upsert(input, {onConflict: "singleton_key"});

        if (error) {
          wrapStorageError("保存站点设置", error);
        }
      },
    },
    checkConfigs: {
      async list(input) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        let query = client
          .from("check_configs")
          .select(
            "id, name, type, model, endpoint, api_key, enabled, is_maintenance, template_id, request_header, metadata, group_name, created_at, updated_at"
          )
          .order("updated_at", {ascending: false})
          .order("created_at", {ascending: false});

        if (input?.enabledOnly) {
          query = query.eq("enabled", true);
        }

        const {data, error} = await query;

        if (error) {
          wrapStorageError("读取检测配置", error);
        }

        return ((data as Array<Record<string, unknown>> | null) ?? []).map(mapCheckConfigRow);
      },
      async getById(id) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {data, error} = await client
          .from("check_configs")
          .select(
            "id, name, type, model, endpoint, api_key, enabled, is_maintenance, template_id, request_header, metadata, group_name, created_at, updated_at"
          )
          .eq("id", id)
          .maybeSingle();

        if (error) {
          wrapStorageError("读取检测配置", error);
        }

        return data ? mapCheckConfigRow(data as Record<string, unknown>) : null;
      },
      async upsert(input: CheckConfigMutationInput) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const payloadId = input.id ?? createStorageId();
        const payload = {
          id: payloadId,
          name: input.name,
          type: input.type,
          model: input.model,
          endpoint: input.endpoint,
          api_key: input.api_key,
          enabled: input.enabled,
          is_maintenance: input.is_maintenance,
          template_id: input.template_id ?? null,
          request_header: input.request_header ?? null,
          metadata: input.metadata ?? null,
          group_name: input.group_name ?? null,
        };

        let error: unknown = null;

        if (input.id) {
          const updateResult = await client
            .from("check_configs")
            .update({
              name: input.name,
              type: input.type,
              model: input.model,
              endpoint: input.endpoint,
              api_key: input.api_key,
              enabled: input.enabled,
              is_maintenance: input.is_maintenance,
              template_id: input.template_id ?? null,
              request_header: input.request_header ?? null,
              metadata: input.metadata ?? null,
              group_name: input.group_name ?? null,
            })
            .eq("id", input.id)
            .select("id");

          if (updateResult.error) {
            error = updateResult.error;
          } else if ((updateResult.data ?? []).length === 0) {
            const insertResult = await client.from("check_configs").insert(payload);
            error = insertResult.error;
          }
        } else {
          const insertResult = await client.from("check_configs").insert(payload);
          error = insertResult.error;
        }

        if (error) {
          wrapStorageError("保存检测配置", error);
        }
      },
      async delete(id) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {error} = await client.from("check_configs").delete().eq("id", id);

        if (error) {
          wrapStorageError("删除检测配置", error);
        }
      },
    },
    requestTemplates: {
      async list() {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {data, error} = await client
          .from("check_request_templates")
          .select("id, name, type, request_header, metadata, created_at, updated_at")
          .order("updated_at", {ascending: false})
          .order("created_at", {ascending: false});

        if (error) {
          wrapStorageError("读取请求模板", error);
        }

        return ((data as Array<Record<string, unknown>> | null) ?? []).map(mapRequestTemplateRow);
      },
      async upsert(input: RequestTemplateMutationInput) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const payloadId = input.id ?? createStorageId();
        const payload = {
          id: payloadId,
          name: input.name,
          type: input.type,
          request_header: input.request_header ?? null,
          metadata: input.metadata ?? null,
        };

        let error: unknown = null;

        if (input.id) {
          const updateResult = await client
            .from("check_request_templates")
            .update({
              name: input.name,
              type: input.type,
              request_header: input.request_header ?? null,
              metadata: input.metadata ?? null,
            })
            .eq("id", input.id)
            .select("id");

          if (updateResult.error) {
            error = updateResult.error;
          } else if ((updateResult.data ?? []).length === 0) {
            const insertResult = await client.from("check_request_templates").insert(payload);
            error = insertResult.error;
          }
        } else {
          const insertResult = await client.from("check_request_templates").insert(payload);
          error = insertResult.error;
        }

        if (error) {
          wrapStorageError("保存请求模板", error);
        }
      },
      async delete(id) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {error} = await client.from("check_request_templates").delete().eq("id", id);

        if (error) {
          wrapStorageError("删除请求模板", error);
        }
      },
    },
    groups: {
      async list() {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {data, error} = await client
          .from("group_info")
          .select("id, group_name, website_url, tags, created_at, updated_at")
          .order("group_name", {ascending: true});

        if (error) {
          wrapStorageError("读取分组信息", error);
        }

        return ((data as Array<Record<string, unknown>> | null) ?? []).map(mapGroupInfoRow);
      },
      async getByName(groupName) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {data, error} = await client
          .from("group_info")
          .select("id, group_name, website_url, tags, created_at, updated_at")
          .eq("group_name", groupName)
          .maybeSingle();

        if (error) {
          wrapStorageError("读取分组信息", error);
        }

        return data ? mapGroupInfoRow(data as Record<string, unknown>) : null;
      },
      async upsert(input: GroupMutationInput) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const payloadId = input.id ?? createStorageId();
        const payload = {
          id: payloadId,
          group_name: input.group_name,
          website_url: input.website_url ?? null,
          tags: input.tags ?? null,
        };

        let error: unknown = null;

        if (input.id) {
          const updateResult = await client
            .from("group_info")
            .update({
              group_name: input.group_name,
              website_url: input.website_url ?? null,
              tags: input.tags ?? null,
            })
            .eq("id", input.id)
            .select("id");

          if (updateResult.error) {
            error = updateResult.error;
          } else if ((updateResult.data ?? []).length === 0) {
            const insertResult = await client.from("group_info").insert(payload);
            error = insertResult.error;
          }
        } else {
          const insertResult = await client.from("group_info").insert(payload);
          error = insertResult.error;
        }

        if (error) {
          wrapStorageError("保存分组信息", error);
        }
      },
      async delete(id) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {error} = await client.from("group_info").delete().eq("id", id);

        if (error) {
          wrapStorageError("删除分组信息", error);
        }
      },
    },
    notifications: {
      async list() {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {data, error} = await client
          .from("system_notifications")
          .select("id, message, is_active, level, created_at")
          .order("created_at", {ascending: false});

        if (error) {
          wrapStorageError("读取系统通知", error);
        }

        return ((data as Array<Record<string, unknown>> | null) ?? []).map(mapNotificationRow);
      },
      async listActive() {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {data, error} = await client
          .from("system_notifications")
          .select("id, message, is_active, level, created_at")
          .eq("is_active", true)
          .order("created_at", {ascending: false});

        if (error) {
          wrapStorageError("读取系统通知", error);
        }

        return ((data as Array<Record<string, unknown>> | null) ?? []).map(mapNotificationRow);
      },
      async upsert(input: NotificationMutationInput) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const payloadId = input.id ?? createStorageId();
        const payload = {
          id: payloadId,
          message: input.message,
          level: input.level,
          is_active: input.is_active,
        };

        let error: unknown = null;

        if (input.id) {
          const updateResult = await client
            .from("system_notifications")
            .update({
              message: input.message,
              level: input.level,
              is_active: input.is_active,
            })
            .eq("id", input.id)
            .select("id");

          if (updateResult.error) {
            error = updateResult.error;
          } else if ((updateResult.data ?? []).length === 0) {
            const insertResult = await client.from("system_notifications").insert(payload);
            error = insertResult.error;
          }
        } else {
          const insertResult = await client.from("system_notifications").insert(payload);
          error = insertResult.error;
        }

        if (error) {
          wrapStorageError("保存系统通知", error);
        }
      },
      async delete(id) {
        await ensureReady();
        const client = createAdminClient({allowDraft});
        const {error} = await client.from("system_notifications").delete().eq("id", id);

        if (error) {
          wrapStorageError("删除系统通知", error);
        }
      },
    },
  };
}
