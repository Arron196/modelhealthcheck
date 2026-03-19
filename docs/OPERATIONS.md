# Check CX 运维手册

本文面向运维与平台工程，描述当前仓库的部署方式、数据库初始化、后台管理与日常排障要点。当前实现不再要求 Supabase 才能运行；它会根据环境变量在 **Supabase / 直连 Postgres / SQLite** 三种后端之间解析当前控制面存储。

## 1. 运行环境

- Node.js 18 及以上（建议 20 LTS）
- pnpm 10
- 三选一的存储后端：
  - **Supabase**：完整能力部署
  - **直连 Postgres**：控制面部署
  - **SQLite**：本地 / 单机部署

## 2. 环境变量

### 2.1 后端解析顺序

应用按以下顺序解析当前控制面存储：

1. 若显式设置 `DATABASE_PROVIDER`，则按该值使用 `supabase | postgres | sqlite`
2. 否则若 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY` 同时存在，则使用 Supabase
3. 否则若 `DATABASE_URL` / `POSTGRES_URL` / `POSTGRES_PRISMA_URL` / `SUPABASE_DB_URL` 任一存在，则使用直连 Postgres
4. 否则回退到 SQLite（默认 `.sisyphus/local-data/app.db`）

### 2.2 核心变量

#### 通用 / 控制面

- `DATABASE_PROVIDER`
- `ADMIN_SESSION_SECRET`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

说明：

- `ADMIN_SESSION_SECRET` 在所有**非 Supabase**部署中都建议显式设置。
- 仅当 `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 与 `TURNSTILE_SECRET_KEY` 同时存在时，后台登录页才会启用 Turnstile。

#### Supabase 模式

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_OR_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`（可选，但运行时迁移/直连检查建议提供）
- `SUPABASE_DB_SCHEMA`（默认 `public`）

#### 直连 Postgres 模式

以下任一变量可作为连接串来源：

- `DATABASE_URL`
- `POSTGRES_URL`
- `POSTGRES_PRISMA_URL`
- `SUPABASE_DB_URL`

#### SQLite 模式

- `SQLITE_DATABASE_PATH`（默认 `.sisyphus/local-data/app.db`）

### 2.3 运行参数

- `CHECK_POLL_INTERVAL_SECONDS`：检测间隔，默认 `60`，范围 `15–600`
- `CHECK_CONCURRENCY`：最大并发，默认 `5`，范围 `1–20`
- `OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS`：官方状态轮询间隔，默认 `300`，范围 `60–3600`
- `HISTORY_RETENTION_DAYS`：历史保留天数，范围 `7–365`

## 3. 数据库初始化

### 3.1 Supabase

Supabase 是当前仓库的**完整能力后端**。正式初始化方式：

1. 执行 `supabase/schema.sql`
2. 再按顺序执行 `supabase/migrations/`，至少覆盖当前仓库新增的 `admin_users`、`site_settings` 等迁移
3. 如需排查或补齐部分运行时对象，可在后台的 `/admin/storage` 页面中查看诊断与自动修复结果

Supabase 模式下才提供：

- 历史快照写入
- 可用性统计视图
- 运行时迁移检查 / 自动修复
- Supabase 专属诊断

### 3.2 直连 Postgres

直连 Postgres 目前主要用于**控制面存储**。首次启动时会自动创建控制面所需表，无需先执行 Supabase schema。

当前默认自动建表覆盖：

- `admin_users`
- `site_settings`
- `check_configs`
- `check_request_templates`
- `group_info`
- `system_notifications`

不提供：

- `check_history` 快照写入
- `availability_stats` 统计视图
- 数据库租约选主
- Supabase 运行时迁移能力

### 3.3 SQLite

SQLite 与直连 Postgres 一样，优先承担控制面读写；首次访问会自动初始化控制面表结构。适合：

- 本地开发
- 单机演示
- 自托管轻量部署

## 4. 部署模式

### 4.1 单进程模式

- 当前默认部署模型是**单进程轮询**。
- 应用实例会直接启动轮询器，不再依赖上游版本中的数据库租约选主。
- 如果未来需要多节点部署，需要重新设计去重 / 选主机制，而不是假设旧租约链路仍然存在。

### 4.2 Docker Compose

- 仓库根目录已提供 `Dockerfile` 与 `docker-compose.yml`
- `docker compose up --build -d` 会直接构建当前仓库，而不是拉取外部镜像
- 若远端后端环境变量为空，容器会自动回退到 `/app/.sisyphus/local-data/app.db`
- `check-cx-data` 命名卷负责持久化 SQLite 文件

### 4.3 镜像运行注意事项

- 当前运行时迁移逻辑只会读取 `RUNTIME_MIGRATIONS` 列出的特定迁移文件，文件本体位于 `supabase/migrations/`
- 因此 Docker 镜像必须把 `supabase/migrations/` 一起打包进去，才能在容器内执行 Supabase 运行时迁移检查 / 自动修复

## 5. 日常运维入口

### 5.1 推荐入口：后台管理页面

当前仓库的首选运维入口是 `/admin`，而不是手写 SQL。后台可直接维护：

- 检测配置
- 请求模板
- 分组信息
- 系统通知
- 站点设置
- 存储诊断 / 运行时迁移检查

### 5.2 仍可使用 SQL 的场景

SQL 仍适合：

- 首次批量导入配置
- 紧急修复控制面数据
- 在 Supabase 模式下执行 schema / migration 维护

最小配置示例：

```sql
INSERT INTO check_configs (name, type, model, endpoint, api_key, enabled)
VALUES ('OpenAI GPT-4o', 'openai', 'gpt-4o-mini', 'https://api.openai.com/v1/chat/completions', 'sk-xxx', true);
```

## 6. 监控与日志

关键日志（服务端）通常包括：

- `[check-cx] 初始化本地后台轮询器...`
- `[check-cx] 后台轮询完成：写入 ...`
- `[check-cx] 本轮检测明细：...`
- `[官方状态] openai: operational - ...`
- `ensure runtime migrations failed`（Supabase 运行时迁移失败时）

建议至少对 `check-cx`、`[官方状态]` 与 `runtime migrations` 关键字建立检索或告警。

## 7. 常见问题

### 7.1 页面没有任何卡片

- 确认 `check_configs` 至少一条 `enabled = true`
- 检查当前控制面后端是否初始化成功
- 检查后台 `/admin/storage` 是否报告存储能力或连接错误

### 7.2 时间线一直为空

- 确认当前后端是否为 **Supabase**
- SQLite / 直连 Postgres 默认不提供历史快照能力
- 若你期望有时间线，请切换到 Supabase 并补齐 schema / migration

### 7.3 官方状态显示 unknown

- 当前仅 OpenAI / Anthropic 实现官方状态
- 检查外网访问、DNS 与目标状态页可达性

### 7.4 后台登录失败

- 确认已设置 `ADMIN_SESSION_SECRET`，或在 Supabase 模式下具备 `SUPABASE_SERVICE_ROLE_KEY`
- 若启用了 Turnstile，确认站点 Key 与 Secret 成对配置

### 7.5 Docker Compose 中 SQLite 数据丢失

- 确认使用仓库自带的 `docker-compose.yml`
- 不要移除 `check-cx-data` 命名卷
- 如自定义 `SQLITE_DATABASE_PATH`，请同步调整卷挂载目录

