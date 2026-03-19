import "server-only";

import {Pool, type QueryResultRow} from "pg";

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
  POSTGRES_CONTROL_PLANE_SCHEMA_STATEMENTS,
  serializeJson,
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
  provider: "postgres",
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

let poolCache:
  | {
      connectionString: string;
      pool: Pool;
    }
  | null = null;

export async function resetPostgresControlPlaneStorageCache(): Promise<void> {
  if (!poolCache) {
    return;
  }

  const current = poolCache;
  poolCache = null;
  try {
    await current.pool.end();
  } catch {
  }
}

function isLocalHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1"].includes(hostname);
}

function getPool(connectionString: string): Pool {
  if (poolCache?.connectionString === connectionString) {
    return poolCache.pool;
  }

  const url = new URL(connectionString);
  const pool = new Pool({
    connectionString,
    ssl: isLocalHost(url.hostname) ? false : {rejectUnauthorized: false},
  });
  poolCache = {
    connectionString,
    pool,
  };

  return pool;
}

function wrapError(action: string, error: unknown): never {
  throw new Error(`${action}失败：${getErrorMessage(error)}`);
}

function mapRows<T extends QueryResultRow>(rows: T[] | undefined): Array<Record<string, unknown>> {
  return (rows ?? []) as Array<Record<string, unknown>>;
}

export function createPostgresControlPlaneStorage(connectionString: string): ControlPlaneStorage {
  const pool = getPool(connectionString);
  let readyPromise: Promise<void> | null = null;

  async function ensureReady(): Promise<void> {
    if (readyPromise) {
      return readyPromise;
    }

    readyPromise = (async () => {
      for (const statement of POSTGRES_CONTROL_PLANE_SCHEMA_STATEMENTS) {
        await pool.query(statement);
      }

      const defaults = getDefaultSiteSettingsRow();
      await pool.query(
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
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (singleton_key) DO NOTHING
        `,
        [
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
          defaults.updated_at,
        ]
      );

      for (const template of getDefaultRequestTemplateRows()) {
        await pool.query(
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
            VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
            ON CONFLICT (id) DO NOTHING
          `,
          [
            template.id,
            template.name,
            template.type,
            serializeJson(template.request_header),
            serializeJson(template.metadata),
            template.created_at,
            template.updated_at,
          ]
        );
      }
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });

    return readyPromise;
  }

  return {
    provider: "postgres",
    capabilities,
    ensureReady,
    adminUsers: {
      async hasAny() {
        await ensureReady();
        try {
          const result = await pool.query(`SELECT id FROM admin_users LIMIT 1`);
          return (result.rowCount ?? result.rows.length) > 0;
        } catch (error) {
          wrapError("读取管理员账户", error);
        }
      },
      async list() {
        await ensureReady();
        try {
          const result = await pool.query(
            `
              SELECT id, username, password_hash, last_login_at, created_at, updated_at
              FROM admin_users
              ORDER BY username ASC
            `
          );

          return mapRows(result.rows).map(mapAdminUserRecord);
        } catch (error) {
          wrapError("读取管理员账户列表", error);
        }
      },
      async findByUsername(username) {
        await ensureReady();
        try {
          const result = await pool.query(
            `
              SELECT id, username, password_hash, last_login_at, created_at, updated_at
              FROM admin_users
              WHERE username = $1
              LIMIT 1
            `,
            [username]
          );

          return result.rows[0] ? mapAdminUserRecord(result.rows[0]) : null;
        } catch (error) {
          wrapError("读取管理员账户", error);
        }
      },
      async create(input) {
        await ensureReady();
        const timestamp = nowIso();
        const id = createStorageId();

        try {
          const result = await pool.query(
            `
              INSERT INTO admin_users (
                id,
                username,
                password_hash,
                last_login_at,
                created_at,
                updated_at
              )
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING id, username, password_hash, last_login_at, created_at, updated_at
            `,
            [id, input.username, input.passwordHash, input.lastLoginAt ?? null, timestamp, timestamp]
          );

          return mapAdminUserRecord(result.rows[0] as Record<string, unknown>);
        } catch (error) {
          wrapError("创建管理员账户", error);
        }
      },
      async replaceAll(records) {
        await ensureReady();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`DELETE FROM admin_users`);

          for (const row of records) {
            await client.query(
              `
                INSERT INTO admin_users (
                  id,
                  username,
                  password_hash,
                  last_login_at,
                  created_at,
                  updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6)
              `,
              [
                row.id,
                row.username,
                row.password_hash,
                row.last_login_at ?? null,
                row.created_at ?? nowIso(),
                row.updated_at ?? nowIso(),
              ]
            );
          }

          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          wrapError("导入管理员账户", error);
        } finally {
          client.release();
        }
      },
      async updateLastLoginAt(id, lastLoginAt) {
        await ensureReady();
        try {
          await pool.query(
            `UPDATE admin_users SET last_login_at = $2, updated_at = $3 WHERE id = $1`,
            [id, lastLoginAt, nowIso()]
          );
        } catch (error) {
          wrapError("更新管理员登录时间", error);
        }
      },
    },
    siteSettings: {
      async getSingleton(singletonKey) {
        await ensureReady();
        try {
          const result = await pool.query(
            `
              SELECT singleton_key, site_name, site_description, hero_badge, hero_title_primary,
                     hero_title_secondary, hero_description, footer_brand,
                     admin_console_title, admin_console_description, created_at, updated_at
              FROM site_settings
              WHERE singleton_key = $1
              LIMIT 1
            `,
            [singletonKey]
          );

          return result.rows[0] ? mapSiteSettingsRow(result.rows[0]) : null;
        } catch (error) {
          wrapError("读取站点设置", error);
        }
      },
      async upsert(input: SiteSettingsMutationInput) {
        await ensureReady();
        const timestamp = nowIso();

        try {
          await pool.query(
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
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              ON CONFLICT (singleton_key)
              DO UPDATE SET
                site_name = EXCLUDED.site_name,
                site_description = EXCLUDED.site_description,
                hero_badge = EXCLUDED.hero_badge,
                hero_title_primary = EXCLUDED.hero_title_primary,
                hero_title_secondary = EXCLUDED.hero_title_secondary,
                hero_description = EXCLUDED.hero_description,
                footer_brand = EXCLUDED.footer_brand,
                admin_console_title = EXCLUDED.admin_console_title,
                admin_console_description = EXCLUDED.admin_console_description,
                updated_at = EXCLUDED.updated_at
            `,
            [
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
              timestamp,
            ]
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
          const result = await pool.query(
            `
              SELECT id, name, type, model, endpoint, api_key, enabled, is_maintenance,
                     template_id, request_header, metadata, group_name, created_at, updated_at
              FROM check_configs
              ${input?.enabledOnly ? "WHERE enabled = true" : ""}
              ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
            `
          );

          return mapRows(result.rows).map(mapCheckConfigRow);
        } catch (error) {
          wrapError("读取检测配置", error);
        }
      },
      async getById(id) {
        await ensureReady();
        try {
          const result = await pool.query(
            `
              SELECT id, name, type, model, endpoint, api_key, enabled, is_maintenance,
                     template_id, request_header, metadata, group_name, created_at, updated_at
              FROM check_configs
              WHERE id = $1
              LIMIT 1
            `,
            [id]
          );

          return result.rows[0] ? mapCheckConfigRow(result.rows[0]) : null;
        } catch (error) {
          wrapError("读取检测配置", error);
        }
      },
      async upsert(input: CheckConfigMutationInput) {
        await ensureReady();
        const timestamp = nowIso();
        const payloadId = input.id ?? createStorageId();
        const requestHeader = serializeJson(input.request_header);
        const metadata = serializeJson(input.metadata);

        try {
          if (input.id) {
            await pool.query(
              `
                UPDATE check_configs
                SET name = $2,
                    type = $3,
                    model = $4,
                    endpoint = $5,
                    api_key = $6,
                    enabled = $7,
                    is_maintenance = $8,
                    template_id = $9,
                    request_header = $10::jsonb,
                    metadata = $11::jsonb,
                    group_name = $12,
                    updated_at = $13
                WHERE id = $1
              `,
              [
                input.id,
                input.name,
                input.type,
                input.model,
                input.endpoint,
                input.api_key,
                input.enabled,
                input.is_maintenance,
                input.template_id ?? null,
                requestHeader,
                metadata,
                input.group_name ?? null,
                timestamp,
              ]
            );
            return;
          }

          await pool.query(
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
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14)
            `,
            [
              payloadId,
              input.name,
              input.type,
              input.model,
              input.endpoint,
              input.api_key,
              input.enabled,
              input.is_maintenance,
              input.template_id ?? null,
              requestHeader,
              metadata,
              input.group_name ?? null,
              timestamp,
              timestamp,
            ]
          );
        } catch (error) {
          wrapError("保存检测配置", error);
        }
      },
      async delete(id) {
        await ensureReady();
        try {
          await pool.query(`DELETE FROM check_configs WHERE id = $1`, [id]);
        } catch (error) {
          wrapError("删除检测配置", error);
        }
      },
    },
    requestTemplates: {
      async list() {
        await ensureReady();
        try {
          const result = await pool.query(
            `
              SELECT id, name, type, request_header, metadata, created_at, updated_at
              FROM check_request_templates
              ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
            `
          );

          return mapRows(result.rows).map(mapRequestTemplateRow);
        } catch (error) {
          wrapError("读取请求模板", error);
        }
      },
      async upsert(input: RequestTemplateMutationInput) {
        await ensureReady();
        const timestamp = nowIso();
        const payloadId = input.id ?? createStorageId();
        const requestHeader = serializeJson(input.request_header);
        const metadata = serializeJson(input.metadata);

        try {
          if (input.id) {
            await pool.query(
              `
                UPDATE check_request_templates
                SET name = $2,
                    type = $3,
                    request_header = $4::jsonb,
                    metadata = $5::jsonb,
                    updated_at = $6
                WHERE id = $1
              `,
              [input.id, input.name, input.type, requestHeader, metadata, timestamp]
            );
            return;
          }

          await pool.query(
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
              VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
            `,
            [payloadId, input.name, input.type, requestHeader, metadata, timestamp, timestamp]
          );
        } catch (error) {
          wrapError("保存请求模板", error);
        }
      },
      async delete(id) {
        await ensureReady();
        try {
          await pool.query(`DELETE FROM check_request_templates WHERE id = $1`, [id]);
        } catch (error) {
          wrapError("删除请求模板", error);
        }
      },
    },
    groups: {
      async list() {
        await ensureReady();
        try {
          const result = await pool.query(
            `
              SELECT id, group_name, website_url, tags, created_at, updated_at
              FROM group_info
              ORDER BY group_name ASC
            `
          );

          return mapRows(result.rows).map(mapGroupInfoRow);
        } catch (error) {
          wrapError("读取分组信息", error);
        }
      },
      async getByName(groupName) {
        await ensureReady();
        try {
          const result = await pool.query(
            `
              SELECT id, group_name, website_url, tags, created_at, updated_at
              FROM group_info
              WHERE group_name = $1
              LIMIT 1
            `,
            [groupName]
          );

          return result.rows[0] ? mapGroupInfoRow(result.rows[0]) : null;
        } catch (error) {
          wrapError("读取分组信息", error);
        }
      },
      async upsert(input: GroupMutationInput) {
        await ensureReady();
        const timestamp = nowIso();
        const payloadId = input.id ?? createStorageId();

        try {
          if (input.id) {
            await pool.query(
              `
                UPDATE group_info
                SET group_name = $2,
                    website_url = $3,
                    tags = $4,
                    updated_at = $5
                WHERE id = $1
              `,
              [input.id, input.group_name, input.website_url ?? null, input.tags ?? null, timestamp]
            );
            return;
          }

          await pool.query(
            `
              INSERT INTO group_info (
                id,
                group_name,
                website_url,
                tags,
                created_at,
                updated_at
              )
              VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [payloadId, input.group_name, input.website_url ?? null, input.tags ?? null, timestamp, timestamp]
          );
        } catch (error) {
          wrapError("保存分组信息", error);
        }
      },
      async delete(id) {
        await ensureReady();
        try {
          await pool.query(`DELETE FROM group_info WHERE id = $1`, [id]);
        } catch (error) {
          wrapError("删除分组信息", error);
        }
      },
    },
    notifications: {
      async list() {
        await ensureReady();
        try {
          const result = await pool.query(
            `
              SELECT id, message, is_active, level, created_at
              FROM system_notifications
              ORDER BY created_at DESC
            `
          );

          return mapRows(result.rows).map(mapNotificationRow);
        } catch (error) {
          wrapError("读取系统通知", error);
        }
      },
      async listActive() {
        await ensureReady();
        try {
          const result = await pool.query(
            `
              SELECT id, message, is_active, level, created_at
              FROM system_notifications
              WHERE is_active = true
              ORDER BY created_at DESC
            `
          );

          return mapRows(result.rows).map(mapNotificationRow);
        } catch (error) {
          wrapError("读取系统通知", error);
        }
      },
      async upsert(input: NotificationMutationInput) {
        await ensureReady();
        const timestamp = nowIso();
        const payloadId = input.id ?? createStorageId();

        try {
          if (input.id) {
            await pool.query(
              `
                UPDATE system_notifications
                SET message = $2,
                    is_active = $3,
                    level = $4
                WHERE id = $1
              `,
              [input.id, input.message, input.is_active, input.level]
            );
            return;
          }

          await pool.query(
            `
              INSERT INTO system_notifications (
                id,
                message,
                is_active,
                level,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5)
            `,
            [payloadId, input.message, input.is_active, input.level, timestamp]
          );
        } catch (error) {
          wrapError("保存系统通知", error);
        }
      },
      async delete(id) {
        await ensureReady();
        try {
          await pool.query(`DELETE FROM system_notifications WHERE id = $1`, [id]);
        } catch (error) {
          wrapError("删除系统通知", error);
        }
      },
    },
  };
}
