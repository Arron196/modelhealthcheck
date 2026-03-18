import "server-only";

import {createAdminClient} from "@/lib/supabase/admin";
import {getErrorMessage} from "@/lib/utils";

import type {
  CheckConfigMutationInput,
  ControlPlaneStorage,
  GroupMutationInput,
  NotificationMutationInput,
  RequestTemplateMutationInput,
  SiteSettingsMutationInput,
  StorageCapabilities,
} from "./types";
import {
  getDefaultRequestTemplateRows,
  mapAdminUserRecord,
  mapCheckConfigRow,
  mapGroupInfoRow,
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

function wrapStorageError(action: string, error: unknown): never {
  throw new Error(`${action}失败：${getErrorMessage(error)}`);
}

export function createSupabaseControlPlaneStorage(): ControlPlaneStorage {
  let readyPromise: Promise<void> | null = null;

  async function ensureReady(): Promise<void> {
    if (readyPromise) {
      return readyPromise;
    }

    readyPromise = (async () => {
      const client = createAdminClient();
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

  return {
    provider: "supabase",
    capabilities,
    ensureReady,
    adminUsers: {
      async hasAny() {
        await ensureReady();
        const client = createAdminClient();
        const {data, error} = await client.from("admin_users").select("id").limit(1);

        if (error) {
          wrapStorageError("读取管理员账户", error);
        }

        return Boolean(data && data.length > 0);
      },
      async findByUsername(username) {
        await ensureReady();
        const client = createAdminClient();
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
        const client = createAdminClient();
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
      async updateLastLoginAt(id, lastLoginAt) {
        await ensureReady();
        const client = createAdminClient();
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
        const client = createAdminClient();
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
        const client = createAdminClient();
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
        const client = createAdminClient();
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
        const client = createAdminClient();
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
        const client = createAdminClient();
        const payload = {
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

        const query = input.id
          ? client.from("check_configs").update(payload).eq("id", input.id)
          : client.from("check_configs").insert(payload);
        const {error} = await query;

        if (error) {
          wrapStorageError("保存检测配置", error);
        }
      },
      async delete(id) {
        await ensureReady();
        const client = createAdminClient();
        const {error} = await client.from("check_configs").delete().eq("id", id);

        if (error) {
          wrapStorageError("删除检测配置", error);
        }
      },
    },
    requestTemplates: {
      async list() {
        await ensureReady();
        const client = createAdminClient();
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
        const client = createAdminClient();
        const payload = {
          name: input.name,
          type: input.type,
          request_header: input.request_header ?? null,
          metadata: input.metadata ?? null,
        };
        const query = input.id
          ? client.from("check_request_templates").update(payload).eq("id", input.id)
          : client.from("check_request_templates").insert(payload);
        const {error} = await query;

        if (error) {
          wrapStorageError("保存请求模板", error);
        }
      },
      async delete(id) {
        await ensureReady();
        const client = createAdminClient();
        const {error} = await client.from("check_request_templates").delete().eq("id", id);

        if (error) {
          wrapStorageError("删除请求模板", error);
        }
      },
    },
    groups: {
      async list() {
        await ensureReady();
        const client = createAdminClient();
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
        const client = createAdminClient();
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
        const client = createAdminClient();
        const payload = {
          group_name: input.group_name,
          website_url: input.website_url ?? null,
          tags: input.tags ?? null,
        };
        const query = input.id
          ? client.from("group_info").update(payload).eq("id", input.id)
          : client.from("group_info").insert(payload);
        const {error} = await query;

        if (error) {
          wrapStorageError("保存分组信息", error);
        }
      },
      async delete(id) {
        await ensureReady();
        const client = createAdminClient();
        const {error} = await client.from("group_info").delete().eq("id", id);

        if (error) {
          wrapStorageError("删除分组信息", error);
        }
      },
    },
    notifications: {
      async list() {
        await ensureReady();
        const client = createAdminClient();
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
        const client = createAdminClient();
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
        const client = createAdminClient();
        const payload = {
          message: input.message,
          level: input.level,
          is_active: input.is_active,
        };
        const query = input.id
          ? client.from("system_notifications").update(payload).eq("id", input.id)
          : client.from("system_notifications").insert(payload);
        const {error} = await query;

        if (error) {
          wrapStorageError("保存系统通知", error);
        }
      },
      async delete(id) {
        await ensureReady();
        const client = createAdminClient();
        const {error} = await client.from("system_notifications").delete().eq("id", id);

        if (error) {
          wrapStorageError("删除系统通知", error);
        }
      },
    },
  };
}
