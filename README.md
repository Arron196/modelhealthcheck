# 模型中转状态检测

模型中转状态检测是一个用于监控 AI 模型 API 可用性与延迟的健康面板。当前仓库基于 `BingZi-233/check-cx` 的 `master` 分支演化而来，但**仅将其作为代码基线参考**；当前仓库的后续功能、运维方式与发布内容均由本仓库独立维护，**与原作者无关**。在保留 Dashboard、分组视图、状态 API 与基础健康检查能力的同时，这个分支已经明显偏向“可自托管、可后台管理、可多存储后端运行”的版本。

![模型中转状态检测 Dashboard](docs/images/index.png)

## 与上游 `BingZi-233/check-cx:master` 的关系

- **基线来源**：本项目基于 `BingZi-233/check-cx:master` 的公开代码与功能基线继续演化。
- **维护关系**：当前仓库不是原仓库的官方分支、镜像或协作仓库；后续提交、功能取舍和部署方式均由当前仓库自行决定。
- **文档目的**：下面的“新增功能 / 去掉或调整的功能”均是相对上游 `master` 的差异说明，方便使用者快速理解当前分支的定位。

## 当前版本新增功能

- **后台管理控制面**：新增 `/admin` 登录与管理界面，可直接在 Web UI 中维护检测配置、分组、通知、站点设置与请求模板，不再只依赖 SQL 手工维护。
- **多存储后端支持**：除 Supabase 外，新增 SQLite 与直连 Postgres 作为控制面存储后端，支持本地 / 自建环境直接运行，并在运行时自动建表或补齐迁移。
- **站点图标可上传**：后台站点设置现在支持直接上传浏览器标签页 / 侧栏图标，系统会自动保存并应用，无需手填路径。
- **存储诊断能力**：新增后台存储诊断页，可检查当前后端、迁移状态与可用性，减少环境配置不一致时的排障成本。
- **请求模板系统增强**：新增默认请求模板种子、模板管理与 yes/no 算术挑战模板支持，方便统一复用请求头、metadata 与验证逻辑。
- **后台登录防护**：新增管理员认证链路，并支持接入 Cloudflare Turnstile 作为登录挑战。
- **自托管部署补强**：Docker / Compose 路径已经按当前仓库实现调整，默认拉取 GHCR 镜像启动，同时保留本地 build 覆盖文件；无远端后端时仍会回退到持久化 SQLite。

## 当前版本去掉或调整的功能

- **去掉上游的多节点数据库租约选主链路**：当前实现默认按**单进程后台轮询**运行，不再保留上游文档中的数据库 lease 选主机制。
- **弱化对 Supabase 的强依赖**：上游以 Supabase / PostgreSQL 为主要运行前提；当前版本改为 Supabase、直连 Postgres、SQLite 三种后端均可运行，Supabase 不再是唯一默认答案。
- **去掉“主要靠 SQL 运维”的使用方式**：上游公开文档更偏向通过 SQL 和迁移脚本管理配置；当前版本把主要运维入口转为后台管理界面，SQL 更适合作为初始化或底层维护手段。
- **调整 Docker Compose 使用模型**：当前仓库默认改为拉取 `ghcr.io/arron196/modelhealthcheck` 镜像运行，同时保留 `docker-compose.build.yml` 作为本地源码构建覆盖层。

## 保留的核心能力

- 统一的 Provider 健康检查（OpenAI / Gemini / Anthropic），支持 Chat Completions 与 Responses 端点
- 实时延迟、Ping 延迟与历史时间线，支持 7/15/30 天可用性统计
- 分组视图与分组详情页（`group_name` + `group_info`），支持分组标签与官网链接
- 维护模式与系统通知横幅（支持 Markdown，多条轮播）
- 官方状态轮询（当前支持 OpenAI 与 Anthropic）
- 单进程后台轮询与历史写入
- 安全默认：模型密钥仅保存在数据库，服务端使用 service role key 或当前后端对应的服务端凭据读取

## 快速开始

### 1. 环境准备

- Node.js 18 及以上（建议 20 LTS）
- pnpm 10
- Supabase 项目（可选）或可访问的 PostgreSQL / 本地 SQLite

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量（可选起步）

```bash
cp .env.example .env.local
```

如果你准备直接接 Supabase、外部 Postgres，或想在首次打开前就固定后台登录密钥，可以先填写 `.env.local`。如果你只是想先把服务跑起来并走首轮 Setup Wizard，也可以只保留默认值，先让应用按自动解析逻辑回退到本地 SQLite，再在浏览器里完成初始配置。

可选变量示例：

```env
DATABASE_PROVIDER=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_OR_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
POSTGRES_URL=
POSTGRES_PRISMA_URL=
SQLITE_DATABASE_PATH=.sisyphus/local-data/app.db
ADMIN_SESSION_SECRET=...
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
SUPABASE_DB_SCHEMA=public
SUPABASE_DB_URL=
CHECK_POLL_INTERVAL_SECONDS=60
HISTORY_RETENTION_DAYS=30
OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS=300
CHECK_CONCURRENCY=5
```

### 4. 初始化数据库 / 首次启动行为

- 使用 **Supabase**：新库请先执行 `supabase/schema.sql`，再按顺序执行 `supabase/migrations/`（至少包含当前仓库新增的 `admin_users`、`site_settings` 等迁移）。如果你希望在后台管理页检查或补齐部分运行时对象，也可以使用 `/admin/storage` 中的诊断与自动修复入口。
- 使用 **本地 / 自建 Postgres**：控制面表与运行时 `check_history` 会在首次访问时自动创建，无需先跑 Supabase schema；可用性统计会基于历史记录直接聚合。
- 使用 **SQLite**：控制面表与运行时 `check_history` 会在首次访问时自动创建到 `SQLITE_DATABASE_PATH`（默认 `.sisyphus/local-data/app.db`），可用性统计同样由历史记录派生。

首次运行时，如果你没有提供 Supabase / Postgres 连接，应用会先使用 SQLite 启动，让你可以直接进入首轮 Setup Wizard / 后台初始化流程，而不是被必填 env 阻塞。后续如果要切到外部 Postgres 或 Supabase，再通过环境变量或后台 `/admin/storage` 调整即可。

> 注意：**Supabase、直连 Postgres、SQLite 现在都会写入历史快照并生成 7/15/30 天可用性统计**。Supabase 仍然独享运行时迁移诊断 / 自动修复与 Supabase 专属诊断能力，但不再是历史与统计的唯一后端。

### 5. 添加最小配置（可选：若你不走首轮向导）

```sql
INSERT INTO check_configs (name, type, model, endpoint, api_key, enabled)
VALUES ('OpenAI GPT-4o',
        'openai',
        'gpt-4o-mini',
        'https://api.openai.com/v1/chat/completions',
        'sk-your-api-key',
        true);
```

### 6. 启动开发服务器

```bash
pnpm dev
```

访问 http://localhost:3000 查看 Dashboard。

## 运行与部署

```bash
pnpm dev    # 本地开发
pnpm build  # 生产构建
pnpm start  # 生产运行
pnpm lint   # 代码检查
```

部署时将 `.env.local` 中的变量注入到部署平台（Vercel、容器或自建服务器）。

### Docker Compose

仓库已自带三种 Compose 入口：默认镜像版 `docker-compose.yml`、本地源码构建覆盖文件 `docker-compose.build.yml`，以及一键拉起 `应用 + PostgreSQL` 的 `docker-compose.postgres.yml`。默认 Compose 会直接拉取 `ghcr.io/arron196/modelhealthcheck:latest`（也可通过 `CHECK_CX_IMAGE` 覆盖），并把 SQLite 回退数据库持久化到命名卷 `check-cx-data`。当前 GitHub Actions 默认发布的是 `linux/amd64` 镜像；如果你在 ARM 主机上直接运行，优先使用自己的多架构 tag，或改用本地 build 覆盖方式。

#### 直接拉取 GHCR 镜像（默认：env 可为空，自动回退 SQLite）

```bash
cp .env.example .env
docker compose pull
docker compose up -d
```

这个默认路径适合“先启动、再在浏览器里完成首轮 Setup Wizard”的部署；即使未填写 Supabase / Postgres 变量，也会先以持久化 SQLite 启动。

#### 一键拉起应用 + PostgreSQL

```bash
docker compose -f docker-compose.postgres.yml up -d
```

这个变体仍然默认拉取 GHCR 镜像，但会同时启动一个本地 PostgreSQL 16 容器，并把应用固定到 `DATABASE_PROVIDER=postgres`。适合你希望首次启动就直接落在 PostgreSQL，而不是先走 SQLite 回退的场景。

如果你要在本机直接构建当前仓库，而不是拉取 GHCR 镜像：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

如果你要把“应用 + PostgreSQL”变体也切换为本地源码构建，可以叠加：

```bash
docker compose -f docker-compose.postgres.yml -f docker-compose.build.yml up -d --build
```

常用命令：

```bash
docker compose logs -f check-cx
docker compose down
```

如果你使用 Supabase 或外部 Postgres，只需要在 `.env` 中填入对应连接信息；如果远端后端变量保持为空，默认 Compose 会按当前实现自动回退到容器内持久化的 SQLite。若你希望避免首轮 SQLite 回退，可直接使用 `docker-compose.postgres.yml`。后台 `/admin/storage` 现在支持一条完整的托管切换流：保存 PostgreSQL 草稿连接、执行连通性测试、把当前数据（含历史记录）导入目标后端，然后按主/备角色启用新的存储拓扑。启用前会重新校验源端与目标端快照，若导入后又产生了新历史，系统会要求重新导入而不是带着过期数据切换。

> 托管主备配置会写入本地 SQLite bootstrap store（默认 `.sisyphus/local-data/storage-bootstrap.db`，可用 `STORAGE_BOOTSTRAP_SQLITE_PATH` 覆盖），不要把这个文件挂在临时磁盘上，否则重启后无法恢复已启用的主备拓扑。**一旦在后台点击“启用主备拓扑”，bootstrap store 中的激活配置会优先于纯 env 自动解析。** 当前实现只在 UI 中做掩码显示，bootstrap SQLite 文件本身仍然属于**明文凭据载体**，需要按 secret 文件管理。

## 配置说明

### 环境变量

| 变量                                       | 必需 | 默认值     | 说明                          |
|------------------------------------------|----|---------|-----------------------------|
| `DATABASE_PROVIDER`                      | 否  | 自动解析 | 显式指定 `supabase` / `postgres` / `sqlite`，否则按解析规则自动选择 |
| `SUPABASE_URL`                           | 否  | -       | Supabase 项目 URL；与 `SUPABASE_SERVICE_ROLE_KEY` 一起构成 Supabase 存储后端 |
| `SUPABASE_PUBLISHABLE_OR_ANON_KEY`       | 否  | -       | Supabase 公共访问 Key；公开链路 / SSR 客户端使用 |
| `SUPABASE_SERVICE_ROLE_KEY`              | 否  | -       | Service Role Key（服务端使用，勿暴露）；仅在 Supabase 模式下也是 `ADMIN_SESSION_SECRET` 的回退值 |
| `DATABASE_URL`                           | 否  | -       | 直连 Postgres 连接串；自动解析时优先于 `POSTGRES_URL` |
| `POSTGRES_URL`                           | 否  | -       | 直连 Postgres 连接串备用变量 |
| `POSTGRES_PRISMA_URL`                    | 否  | -       | 兼容 Prisma / 平台注入的 Postgres 连接串，也会参与自动解析 |
| `SUPABASE_DB_URL`                        | 否  | -       | Supabase 直连 Postgres 连接串；仍可用于运行时 migration |
| `SQLITE_DATABASE_PATH`                   | 否  | `.sisyphus/local-data/app.db` | SQLite 文件路径，建议保留在项目目录的 server-only 路径 |
| `ADMIN_SESSION_SECRET`                   | 否  | `SUPABASE_SERVICE_ROLE_KEY`（若已提供） | 后台登录 session 签名密钥；SQLite / Postgres 环境请显式填写 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`         | 否  | -       | Cloudflare Turnstile 站点 Key；需与 `TURNSTILE_SECRET_KEY` 同时配置才会启用 |
| `TURNSTILE_SECRET_KEY`                   | 否  | -       | Cloudflare Turnstile 服务端 Secret；需与站点 Key 成对出现 |
| `SUPABASE_DB_SCHEMA`                     | 否  | `public` | Supabase schema 名称；只有本地显式使用 dev schema 时才改为 `dev` |
| `CHECK_POLL_INTERVAL_SECONDS`            | 否  | `60`    | 检测间隔（15–600 秒）              |
| `CHECK_CONCURRENCY`                      | 否  | `5`     | 最大并发（1–20）                  |
| `OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS` | 否  | `300`   | 官方状态轮询间隔（60–3600 秒）         |
| `HISTORY_RETENTION_DAYS`                 | 否  | `30`    | 历史保留天数（7–365）               |

### 数据库后端解析规则

控制面存储后端按以下固定顺序解析，保证本地与生产环境行为可预测：

1. `DATABASE_PROVIDER` 显式值优先：`supabase` | `postgres` | `sqlite`
2. 未显式指定时，若 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` 完整，则使用 Supabase
3. 否则若 `DATABASE_URL` / `POSTGRES_URL` / `POSTGRES_PRISMA_URL` / `SUPABASE_DB_URL` 任一完整，则使用 Postgres
4. 否则回退到 SQLite，默认写入 `.sisyphus/local-data/app.db`

SQLite / 直连 Postgres / Supabase 现在都覆盖完整的单实例运行路径：管理员认证、站点设置、检测配置、请求模板、分组信息、系统通知、历史快照写入与可用性统计。差异主要在于：Supabase 仍然提供运行时迁移检查 / 自动修复与 Supabase 专属诊断；托管主备切换会导入并校验当前数据（含历史记录），但仍然**不是双写或 active-active 同步**。备用后端也允许显式设为 `none`，表示当前拓扑只运行单主而不配置热备用。

### Provider 配置要点

- `check_configs.type` 目前支持 `openai` / `gemini` / `anthropic`。
- `endpoint` 必须是完整端点：
    - `/v1/chat/completions` 使用 Chat Completions
    - `/v1/responses` 使用 Responses API
- `request_header` 与 `metadata` 允许注入自定义请求头与请求体参数。
- 可选 `template_id` 关联 `check_request_templates`，用于复用默认请求头与 metadata。
- `check_request_templates.type` 必须与 `check_configs.type` 一致（如 `anthropic` 只能绑定 `anthropic` 模板）。
- 合并优先级：`template` < `check_configs`（实例配置覆盖模板同名字段）。
- `is_maintenance = true` 会保留卡片但停止轮询；`enabled = false` 则完全不纳入检测。

## API 概览

- `GET /api/dashboard?trendPeriod=7d|15d|30d`：Dashboard 聚合数据（带 ETag）。返回完整时间线与可用性统计。
- `GET /api/group/[groupName]?trendPeriod=7d|15d|30d`：分组详情数据。
- `GET /api/v1/status?group=...&model=...`：对外只读状态 API。

更详细的接口与数据结构见文档。

## 文档

- 架构说明：`docs/ARCHITECTURE.md`
- 运维手册：`docs/OPERATIONS.md`
- Provider 扩展：`docs/EXTENDING_PROVIDERS.md`

## 许可证

[MIT](LICENSE)
