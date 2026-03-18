# Check CX

Check CX 是一个用于监控 AI 模型 API 可用性与延迟的健康面板。项目基于 Next.js App Router，支持使用 Supabase 作为默认后端，也支持本地 / 自建 Postgres 与 SQLite 作为控制面回退存储；通过后台轮询持续采集健康结果，并提供可视化 Dashboard 与只读状态 API，适合团队内部状态墙、供应商 SLA 监控与多模型对比。

![Check CX Dashboard](docs/images/index.png)

## 功能概览

- 统一的 Provider 健康检查（OpenAI / Gemini / Anthropic），支持 Chat Completions 与 Responses 端点
- 实时延迟、Ping 延迟与历史时间线，支持 7/15/30 天可用性统计
- 分组视图与分组详情页（`group_name` + `group_info`），支持分组标签与官网链接
- 维护模式与系统通知横幅（支持 Markdown，多条轮播）
- 官方状态轮询（当前支持 OpenAI 与 Anthropic）
- 多节点部署自动选主（数据库租约保证单节点执行轮询）
- 安全默认：模型密钥仅保存在数据库，服务端使用 service role key 读取

## 快速开始

### 1. 环境准备

- Node.js 18 及以上（建议 20 LTS）
- pnpm 10
- Supabase 项目（可选）或可访问的 PostgreSQL / 本地 SQLite

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

```bash
cp .env.example .env.local
```

填写 `.env.local`：

```env
DATABASE_PROVIDER=
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_OR_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=
POSTGRES_URL=
SQLITE_DATABASE_PATH=.sisyphus/local-data/app.db
ADMIN_SESSION_SECRET=...
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
SUPABASE_DB_SCHEMA=public
SUPABASE_DB_URL=
CHECK_NODE_ID=local
CHECK_POLL_INTERVAL_SECONDS=60
HISTORY_RETENTION_DAYS=30
OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS=300
CHECK_CONCURRENCY=5
```

### 4. 初始化数据库

- 使用 Supabase：执行 `supabase/schema.sql`（如需开发 schema，请执行 `supabase/schema-dev.sql`）；已存在数据库则按顺序执行 `supabase/migrations/`。
- 使用本地 / 自建 Postgres：控制面（管理员、站点设置、配置、模板、分组、通知）所需表会由应用在首次访问时自动创建；如要继续启用历史、租约和视图能力，仍建议同步执行 `supabase/schema.sql` 中对应结构。
- 使用 SQLite：控制面所需表会在首次访问时自动创建到 `SQLITE_DATABASE_PATH`（默认 `.sisyphus/local-data/app.db`）。

### 5. 添加最小配置

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

## 配置说明

### 环境变量

| 变量                                       | 必需 | 默认值     | 说明                          |
|------------------------------------------|----|---------|-----------------------------|
| `DATABASE_PROVIDER`                      | 否  | 自动解析 | 显式指定 `supabase` / `postgres` / `sqlite`，否则按解析规则自动选择 |
| `SUPABASE_URL`                           | 否  | -       | Supabase 项目 URL；与 `SUPABASE_SERVICE_ROLE_KEY` 一起构成 Supabase 存储后端 |
| `SUPABASE_PUBLISHABLE_OR_ANON_KEY`       | 否  | -       | Supabase 公共访问 Key；公开链路 / SSR 客户端使用 |
| `SUPABASE_SERVICE_ROLE_KEY`              | 否  | -       | Service Role Key（服务端使用，勿暴露）；也是默认 session secret 回退值 |
| `DATABASE_URL`                           | 否  | -       | 直连 Postgres 连接串；自动解析时优先于 `POSTGRES_URL` |
| `POSTGRES_URL`                           | 否  | -       | 直连 Postgres 连接串备用变量 |
| `SUPABASE_DB_URL`                        | 否  | -       | Supabase 直连 Postgres 连接串；仍可用于运行时 migration |
| `SQLITE_DATABASE_PATH`                   | 否  | `.sisyphus/local-data/app.db` | SQLite 文件路径，建议保留在项目目录的 server-only 路径 |
| `ADMIN_SESSION_SECRET`                   | 否  | `SUPABASE_SERVICE_ROLE_KEY` | 后台登录 session 签名密钥；非 Supabase 环境建议显式配置 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`         | 否  | -       | Cloudflare Turnstile 站点 Key，填写后登录页展示挑战 |
| `TURNSTILE_SECRET_KEY`                   | 否  | -       | Cloudflare Turnstile 服务端 Secret，需与站点 Key 同时配置 |
| `SUPABASE_DB_SCHEMA`                     | 否  | `public` | Supabase schema 名称；只有本地显式使用 dev schema 时才改为 `dev` |
| `CHECK_NODE_ID`                          | 否  | `local` | 节点身份，用于多节点选主                |
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

目前 SQLite / 直连 Postgres 优先覆盖控制面路径：管理员认证、站点设置、检测配置、请求模板、分组信息和系统通知。历史快照、可用性视图和轮询租约仍保留为可选能力，后续功能应通过能力判断而不是写死 Supabase 假设。

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
