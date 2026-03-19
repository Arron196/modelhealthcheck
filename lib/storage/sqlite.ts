import "server-only";

import {mkdirSync} from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {getErrorMessage} from "@/lib/utils";

import {
  createStorageId,
  getDefaultRequestTemplateRows,
  getDefaultSiteSettingsRow,
  mapAdminUserRecord,
  mapCheckConfigRow,
  mapGroupInfoRow,
  mapNotificationRow,
  mapRequestTemplateRow,
  mapSiteSettingsRow,
  nowIso,
  serializeJson,
  SQLITE_CONTROL_PLANE_SCHEMA_STATEMENTS,
} from "./shared";
import type {
  CheckConfigMutationInput,
  ControlPlaneStorage,
  GroupMutationInput,
  NotificationMutationInput,
  RequestTemplateMutationInput,
  SiteSettingsMutationInput,
  StorageCapabilities,
} from "./types";

const capabilities: StorageCapabilities = {
  provider: "sqlite",
  adminAuth: true,
  siteSettings: true,
  controlPlaneCrud: true,
  requestTemplates: true,
  groups: true,
  notifications: true,
  historySnapshots: false,
  availabilityStats: false,
  pollerLease: false,
  runtimeMigrations: false,
  supabaseDiagnostics: false,
  autoProvisionControlPlane: true,
};

let sqliteCache:
  | {
      filePath: string;
      db: Database.Database;
    }
  | null = null;

export function resetSqliteControlPlaneStorageCache(): void {
  if (sqliteCache) {
    try {
      sqliteCache.db.close();
    } catch {
    }
  }

  sqliteCache = null;
}

function getDatabase(filePath: string): Database.Database {
  if (sqliteCache?.filePath === filePath) {
    return sqliteCache.db;
  }

  mkdirSync(path.dirname(filePath), {recursive: true});
  const db = new Database(filePath);
  sqliteCache = {
    filePath,
    db,
  };

  return db;
}

function wrapError(action: string, error: unknown): never {
  throw new Error(`${action}失败：${getErrorMessage(error)}`);
}

export function createSqliteControlPlaneStorage(filePath: string): ControlPlaneStorage {
  const db = getDatabase(filePath);
  let readyPromise: Promise<void> | null = null;

  async function ensureReady(): Promise<void> {
    if (readyPromise) {
      return readyPromise;
    }

    readyPromise = Promise.resolve()
      .then(() => {
        for (const statement of SQLITE_CONTROL_PLANE_SCHEMA_STATEMENTS) {
          db.prepare(statement).run();
        }

        const defaults = getDefaultSiteSettingsRow();
        db.prepare(
          `
            INSERT INTO site_settings (
              singleton_key,
              site_name,
              site_description,
              hero_badge,
              hero_title_primary,
              hero_title_secondary,
              hero_description,
              footer_brand,
              admin_console_title,
              admin_console_description,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(singleton_key) DO NOTHING
          `
        ).run(
          defaults.singleton_key,
          defaults.site_name,
          defaults.site_description,
          defaults.hero_badge,
          defaults.hero_title_primary,
          defaults.hero_title_secondary,
          defaults.hero_description,
          defaults.footer_brand,
          defaults.admin_console_title,
          defaults.admin_console_description,
          defaults.created_at,
          defaults.updated_at
        );

        const templateStatement = db.prepare(
          `
            INSERT INTO check_request_templates (
              id,
              name,
              type,
              request_header,
              metadata,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
          `
        );

        for (const template of getDefaultRequestTemplateRows()) {
          templateStatement.run(
            template.id,
            template.name,
            template.type,
            serializeJson(template.request_header),
            serializeJson(template.metadata),
            template.created_at,
            template.updated_at
          );
        }
      })
      .catch((error) => {
        readyPromise = null;
        throw error;
      });

    return readyPromise;
  }

  return {
    provider: "sqlite",
    capabilities,
    ensureReady,
    adminUsers: {
      async hasAny() {
        await ensureReady();
        try {
          const row = db.prepare(`SELECT id FROM admin_users LIMIT 1`).get() as
            | Record<string, unknown>
            | undefined;
          return Boolean(row?.id);
        } catch (error) {
          wrapError("读取管理员账户", error);
        }
      },
      async list() {
        await ensureReady();
        try {
          const rows = db
            .prepare(
              `
                SELECT id, username, password_hash, last_login_at, created_at, updated_at
                FROM admin_users
                ORDER BY username ASC
              `
            )
            .all() as Array<Record<string, unknown>>;

          return rows.map(mapAdminUserRecord);
        } catch (error) {
          wrapError("读取管理员账户列表", error);
        }
      },
      async findByUsername(username) {
        await ensureReady();
        try {
          const row = db
            .prepare(
              `
                SELECT id, username, password_hash, last_login_at, created_at, updated_at
                FROM admin_users
                WHERE username = ?
                LIMIT 1
              `
            )
            .get(username) as Record<string, unknown> | undefined;

          return row ? mapAdminUserRecord(row) : null;
        } catch (error) {
          wrapError("读取管理员账户", error);
        }
      },
      async create(input) {
        await ensureReady();
        const id = createStorageId();
        const timestamp = nowIso();

        try {
          db.prepare(
            `
              INSERT INTO admin_users (
                id,
                username,
                password_hash,
                last_login_at,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?)
            `
          ).run(id, input.username, input.passwordHash, input.lastLoginAt ?? null, timestamp, timestamp);

          return mapAdminUserRecord({
            id,
            username: input.username,
            password_hash: input.passwordHash,
            last_login_at: input.lastLoginAt ?? null,
            created_at: timestamp,
            updated_at: timestamp,
          });
        } catch (error) {
          wrapError("创建管理员账户", error);
        }
      },
      async replaceAll(records) {
        await ensureReady();
        try {
          const insertStatement = db.prepare(
            `
              INSERT INTO admin_users (
                id,
                username,
                password_hash,
                last_login_at,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?)
            `
          );
          const transaction = db.transaction((rows: typeof records) => {
            db.prepare(`DELETE FROM admin_users`).run();
            for (const row of rows) {
              insertStatement.run(
                row.id,
                row.username,
                row.password_hash,
                row.last_login_at ?? null,
                row.created_at ?? nowIso(),
                row.updated_at ?? nowIso()
              );
            }
          });

          transaction(records);
        } catch (error) {
          wrapError("导入管理员账户", error);
        }
      },
      async updateLastLoginAt(id, lastLoginAt) {
        await ensureReady();
        try {
          db.prepare(
            `UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?`
          ).run(lastLoginAt, nowIso(), id);
        } catch (error) {
          wrapError("更新管理员登录时间", error);
        }
      },
    },
    siteSettings: {
      async getSingleton(singletonKey) {
        await ensureReady();
        try {
          const row = db
            .prepare(
              `
                SELECT singleton_key, site_name, site_description, hero_badge, hero_title_primary,
                       hero_title_secondary, hero_description, footer_brand,
                       admin_console_title, admin_console_description, created_at, updated_at
                FROM site_settings
                WHERE singleton_key = ?
                LIMIT 1
              `
            )
            .get(singletonKey) as Record<string, unknown> | undefined;

          return row ? mapSiteSettingsRow(row) : null;
        } catch (error) {
          wrapError("读取站点设置", error);
        }
      },
      async upsert(input: SiteSettingsMutationInput) {
        await ensureReady();
        const timestamp = nowIso();

        try {
          db.prepare(
            `
              INSERT INTO site_settings (
                singleton_key,
                site_name,
                site_description,
                hero_badge,
                hero_title_primary,
                hero_title_secondary,
                hero_description,
                footer_brand,
                admin_console_title,
                admin_console_description,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(singleton_key) DO UPDATE SET
                site_name = excluded.site_name,
                site_description = excluded.site_description,
                hero_badge = excluded.hero_badge,
                hero_title_primary = excluded.hero_title_primary,
                hero_title_secondary = excluded.hero_title_secondary,
                hero_description = excluded.hero_description,
                footer_brand = excluded.footer_brand,
                admin_console_title = excluded.admin_console_title,
                admin_console_description = excluded.admin_console_description,
                updated_at = excluded.updated_at
            `
          ).run(
            input.singleton_key,
            input.site_name,
            input.site_description,
            input.hero_badge,
            input.hero_title_primary,
            input.hero_title_secondary,
            input.hero_description,
            input.footer_brand,
            input.admin_console_title,
            input.admin_console_description,
            timestamp,
            timestamp
          );
        } catch (error) {
          wrapError("保存站点设置", error);
        }
      },
    },
    checkConfigs: {
      async list(input) {
        await ensureReady();
        try {
          const statement = db.prepare(
            `
              SELECT id, name, type, model, endpoint, api_key, enabled, is_maintenance,
                     template_id, request_header, metadata, group_name, created_at, updated_at
              FROM check_configs
              ${input?.enabledOnly ? "WHERE enabled = 1" : ""}
              ORDER BY updated_at DESC, created_at DESC
            `
          );
          const rows = statement.all() as Array<Record<string, unknown>>;
          return rows.map(mapCheckConfigRow);
        } catch (error) {
          wrapError("读取检测配置", error);
        }
      },
      async getById(id) {
        await ensureReady();
        try {
          const row = db
            .prepare(
              `
                SELECT id, name, type, model, endpoint, api_key, enabled, is_maintenance,
                       template_id, request_header, metadata, group_name, created_at, updated_at
                FROM check_configs
                WHERE id = ?
                LIMIT 1
              `
            )
            .get(id) as Record<string, unknown> | undefined;

          return row ? mapCheckConfigRow(row) : null;
        } catch (error) {
          wrapError("读取检测配置", error);
        }
      },
      async upsert(input: CheckConfigMutationInput) {
        await ensureReady();
        const timestamp = nowIso();
        const payloadId = input.id ?? createStorageId();

        try {
          db.prepare(
            `
              INSERT INTO check_configs (
                id,
                name,
                type,
                model,
                endpoint,
                api_key,
                enabled,
                is_maintenance,
                template_id,
                request_header,
                metadata,
                group_name,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                type = excluded.type,
                model = excluded.model,
                endpoint = excluded.endpoint,
                api_key = excluded.api_key,
                enabled = excluded.enabled,
                is_maintenance = excluded.is_maintenance,
                template_id = excluded.template_id,
                request_header = excluded.request_header,
                metadata = excluded.metadata,
                group_name = excluded.group_name,
                updated_at = excluded.updated_at
            `
          ).run(
            payloadId,
            input.name,
            input.type,
            input.model,
            input.endpoint,
            input.api_key,
            input.enabled ? 1 : 0,
            input.is_maintenance ? 1 : 0,
            input.template_id ?? null,
            serializeJson(input.request_header),
            serializeJson(input.metadata),
            input.group_name ?? null,
            timestamp,
            timestamp
          );
        } catch (error) {
          wrapError("保存检测配置", error);
        }
      },
      async delete(id) {
        await ensureReady();
        try {
          db.prepare(`DELETE FROM check_configs WHERE id = ?`).run(id);
        } catch (error) {
          wrapError("删除检测配置", error);
        }
      },
    },
    requestTemplates: {
      async list() {
        await ensureReady();
        try {
          const rows = db
            .prepare(
              `
                SELECT id, name, type, request_header, metadata, created_at, updated_at
                FROM check_request_templates
                ORDER BY updated_at DESC, created_at DESC
              `
            )
            .all() as Array<Record<string, unknown>>;
          return rows.map(mapRequestTemplateRow);
        } catch (error) {
          wrapError("读取请求模板", error);
        }
      },
      async upsert(input: RequestTemplateMutationInput) {
        await ensureReady();
        const timestamp = nowIso();
        const payloadId = input.id ?? createStorageId();

        try {
          db.prepare(
            `
              INSERT INTO check_request_templates (
                id,
                name,
                type,
                request_header,
                metadata,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                type = excluded.type,
                request_header = excluded.request_header,
                metadata = excluded.metadata,
                updated_at = excluded.updated_at
            `
          ).run(
            payloadId,
            input.name,
            input.type,
            serializeJson(input.request_header),
            serializeJson(input.metadata),
            timestamp,
            timestamp
          );
        } catch (error) {
          wrapError("保存请求模板", error);
        }
      },
      async delete(id) {
        await ensureReady();
        try {
          db.prepare(`DELETE FROM check_request_templates WHERE id = ?`).run(id);
        } catch (error) {
          wrapError("删除请求模板", error);
        }
      },
    },
    groups: {
      async list() {
        await ensureReady();
        try {
          const rows = db
            .prepare(
              `
                SELECT id, group_name, website_url, tags, created_at, updated_at
                FROM group_info
                ORDER BY group_name ASC
              `
            )
            .all() as Array<Record<string, unknown>>;
          return rows.map(mapGroupInfoRow);
        } catch (error) {
          wrapError("读取分组信息", error);
        }
      },
      async getByName(groupName) {
        await ensureReady();
        try {
          const row = db
            .prepare(
              `
                SELECT id, group_name, website_url, tags, created_at, updated_at
                FROM group_info
                WHERE group_name = ?
                LIMIT 1
              `
            )
            .get(groupName) as Record<string, unknown> | undefined;

          return row ? mapGroupInfoRow(row) : null;
        } catch (error) {
          wrapError("读取分组信息", error);
        }
      },
      async upsert(input: GroupMutationInput) {
        await ensureReady();
        const timestamp = nowIso();
        const payloadId = input.id ?? createStorageId();

        try {
          db.prepare(
            `
              INSERT INTO group_info (
                id,
                group_name,
                website_url,
                tags,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                group_name = excluded.group_name,
                website_url = excluded.website_url,
                tags = excluded.tags,
                updated_at = excluded.updated_at
            `
          ).run(
            payloadId,
            input.group_name,
            input.website_url ?? null,
            input.tags ?? null,
            timestamp,
            timestamp
          );
        } catch (error) {
          wrapError("保存分组信息", error);
        }
      },
      async delete(id) {
        await ensureReady();
        try {
          db.prepare(`DELETE FROM group_info WHERE id = ?`).run(id);
        } catch (error) {
          wrapError("删除分组信息", error);
        }
      },
    },
    notifications: {
      async list() {
        await ensureReady();
        try {
          const rows = db
            .prepare(
              `
                SELECT id, message, is_active, level, created_at
                FROM system_notifications
                ORDER BY created_at DESC
              `
            )
            .all() as Array<Record<string, unknown>>;
          return rows.map(mapNotificationRow);
        } catch (error) {
          wrapError("读取系统通知", error);
        }
      },
      async listActive() {
        await ensureReady();
        try {
          const rows = db
            .prepare(
              `
                SELECT id, message, is_active, level, created_at
                FROM system_notifications
                WHERE is_active = 1
                ORDER BY created_at DESC
              `
            )
            .all() as Array<Record<string, unknown>>;
          return rows.map(mapNotificationRow);
        } catch (error) {
          wrapError("读取系统通知", error);
        }
      },
      async upsert(input: NotificationMutationInput) {
        await ensureReady();
        const timestamp = nowIso();
        const payloadId = input.id ?? createStorageId();

        try {
          db.prepare(
            `
              INSERT INTO system_notifications (
                id,
                message,
                is_active,
                level,
                created_at
              )
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                message = excluded.message,
                is_active = excluded.is_active,
                level = excluded.level
            `
          ).run(payloadId, input.message, input.is_active ? 1 : 0, input.level, timestamp);
        } catch (error) {
          wrapError("保存系统通知", error);
        }
      },
      async delete(id) {
        await ensureReady();
        try {
          db.prepare(`DELETE FROM system_notifications WHERE id = ?`).run(id);
        } catch (error) {
          wrapError("删除系统通知", error);
        }
      },
    },
  };
}
