# Check CX 运维手册

本文面向运维与平台工程，描述当前仓库的部署方式、数据库初始化、后台管理与日常排障要点。当前实现不再要求 Supabase 才能运行；它会根据环境变量在 **Supabase / 直连 Postgres / SQLite** 三种后端之间解析当前控制面存储，并允许在 `/admin/storage` 中维护一个受控的 PostgreSQL / Supabase 主备拓扑。**当你在后台启用了托管主备拓扑后，bootstrap store 中的激活配置会覆盖纯 env 自动解析结果。**

## 1. 运行环境

- Node.js 18 及以上（建议 20 LTS）
- pnpm 10
- 三选一的存储后端：
  - **Supabase**：完整能力部署
  - **直连 Postgres**：完整单实例部署
  - **SQLite**：本地 / 单机完整部署

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

Supabase 是当前仓库能力最完整的后端。正式初始化方式：

1. 执行 `supabase/schema.sql`
2. 再按顺序执行 `supabase/migrations/`，至少覆盖当前仓库新增的 `admin_users`、`site_settings` 等迁移
3. 如需排查或补齐部分运行时对象，可在后台的 `/admin/storage` 页面中查看诊断与自动修复结果

Supabase 仍然额外提供：

- 运行时迁移检查 / 自动修复
- Supabase 专属诊断

### 3.2 直连 Postgres

直连 Postgres 现在可承接完整单实例运行：首次启动时会自动创建控制面表与 `check_history`，无需先执行 Supabase schema；可用性统计直接基于历史记录聚合。

如果你要把 PostgreSQL 纳入正式主备管理，请在 `/admin/storage` 中按以下顺序操作：

1. 保存 PostgreSQL 草稿连接与主/备角色
2. 执行 PostgreSQL 连接测试，确认握手、`public schema` 权限与控制面表覆盖情况
3. 执行“导入当前数据到目标后端”，把管理员、站点设置（含自定义图标）、检测配置、模板、分组、通知与历史记录复制到目标后端
4. 启用新的主备拓扑

> 这套托管配置不会写进 `site_settings` 或公开页面，而是写入本地 SQLite bootstrap store（默认 `.sisyphus/local-data/storage-bootstrap.db`，可用 `STORAGE_BOOTSTRAP_SQLITE_PATH` 覆盖）。部署时必须确保该文件所在磁盘可持久化，并把该文件当作**明文 secret 存储**来保护。

当前默认自动建表覆盖：

- `admin_users`
- `site_settings`
- `check_configs`
- `check_request_templates`
- `group_info`
- `system_notifications`
- `check_history`

仍不提供：

- 数据库租约选主
- Supabase 运行时迁移能力

### 3.3 托管主备说明

- v1 只支持 **单主单备** 或 **单主无备**：`Supabase primary / PostgreSQL backup`、`PostgreSQL primary / Supabase backup`，或把备用后端显式设为 `none`
- 备用后端只作为受控切换目标，不做双写
- PostgreSQL 连接串由后台持久化管理；Supabase 仍使用当前部署环境中的 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`
- 启用动作会更新 bootstrap authority，并在运行时重置 resolver、Dashboard、分组、历史相关内存缓存；若你的部署是多实例，必须确保所有实例共享同一个 bootstrap SQLite 文件或采用单实例滚动切换
- 当前托管导入会校验**当前数据（含历史记录）**的一致性，但仍然不是双写：如果导入后源端又产生了新历史，启用会被阻止并要求重新导入

### 3.4 SQLite

SQLite 与直连 Postgres 一样，首次访问会自动初始化控制面表与 `check_history`。适合：

- 本地开发
- 单机演示
- 自托管轻量部署

## 4. 部署模式

### 4.1 单进程模式

- 当前默认部署模型是**单进程轮询**。
- 应用实例会直接启动轮询器，不再依赖上游版本中的数据库租约选主。
- 如果未来需要多节点部署，需要重新设计去重 / 选主机制，而不是假设旧租约链路仍然存在。

### 4.2 Docker Compose

- 仓库根目录提供默认镜像版 `docker-compose.yml`、一键拉起 `应用 + PostgreSQL` 的 `docker-compose.postgres.yml`，以及本地源码构建覆盖文件 `docker-compose.build.yml`
- 默认 `docker compose up -d` 会拉取 `ghcr.io/arron196/modelhealthcheck:latest`（也可通过 `CHECK_CX_IMAGE` 覆盖）
- `docker compose -f docker-compose.postgres.yml up -d` 同样默认拉取 GHCR 镜像，但会额外创建一个本地 PostgreSQL 16 容器，并把应用固定到直连 Postgres
- 如果你要本地构建当前仓库，请显式叠加 `docker-compose.build.yml`
- 当前 GitHub Actions 默认发布的是 `linux/amd64` 镜像；ARM 主机如需直接运行 GHCR 镜像，请改用自建多架构 tag 或本地构建覆盖
- 若远端后端环境变量为空，容器会自动回退到 `/app/.sisyphus/local-data/app.db`
- `check-cx-data` 命名卷负责持久化 SQLite 文件
- `check-cx-postgres-data` 命名卷负责持久化 `docker-compose.postgres.yml` 中 PostgreSQL 容器的数据目录

默认镜像启动：

```bash
cp .env.example .env
docker compose pull
docker compose up -d
```

这个默认路径适合新的首轮部署模型：即使你暂时不填 Supabase / Postgres 连接，也可以先让应用启动，再通过首轮 Setup Wizard 或后台初始化流程完成配置。

应用 + PostgreSQL 一键启动：

```bash
docker compose -f docker-compose.postgres.yml up -d
```

该变体会直接把应用运行数据落到 Compose 内置的 PostgreSQL，而不是先走 SQLite 回退。

本地源码构建覆盖：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

如需把 `应用 + PostgreSQL` 变体改为本地构建镜像：

```bash
docker compose -f docker-compose.postgres.yml -f docker-compose.build.yml up -d --build
```

### 4.3 镜像运行注意事项

- 默认 `docker-compose.yml` 仍然是推荐的 GHCR 镜像入口；新增 `docker-compose.postgres.yml` 只是为“首次部署就要内置 PostgreSQL”的场景提供一键选项
- 首轮 Setup Wizard / 后台初始化流程不再要求先把所有数据库 env 填完：默认镜像路径会先用持久化 SQLite 启动，PostgreSQL 变体则会直接提供可用的本地数据库

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
- 站点浏览器图标（favicon / 侧栏图标，可直接上传替换）
- 存储诊断 / 运行时迁移检查
- PostgreSQL 候选连接测试 / 只读诊断

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

- 确认至少存在一条 `enabled = true` 的检测配置
- 检查后台 `/admin/storage` 是否报告历史仓库或可用性统计错误
- 若刚完成托管切换，请确认最近一次“导入当前数据（含历史记录）”成功；若导入后源端又产生了新历史，需要重新导入后再启用

### 7.3 官方状态显示 unknown

- 当前仅 OpenAI / Anthropic 实现官方状态
- 检查外网访问、DNS 与目标状态页可达性

### 7.4 后台登录失败

- 确认已设置 `ADMIN_SESSION_SECRET`，或在 Supabase 模式下具备 `SUPABASE_SERVICE_ROLE_KEY`
- 若启用了 Turnstile，确认站点 Key 与 Secret 成对配置

### 7.5 Docker Compose 中 SQLite 数据丢失

- 确认使用仓库自带的 `docker-compose.yml`，且本地构建场景额外叠加的是 `docker-compose.build.yml`
- 不要移除 `check-cx-data` 命名卷
- 如自定义 `SQLITE_DATABASE_PATH`，请同步调整卷挂载目录

