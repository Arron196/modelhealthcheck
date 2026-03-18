# Check CX 架构说明

本文档描述 Check CX 的整体架构、核心数据流以及模块边界，确保文档与当前实现一致。

## 1. 总览

Check CX 由三部分组成：

1. **Next.js App Router**：提供 Dashboard 页面与 API 路由。
2. **后台轮询器**：定时执行健康检查，写入当前活动存储后端。
3. **Supabase 数据层**：存储配置、历史与统计视图。

核心数据流：

```
check_configs → 轮询器 → check_history → 聚合快照 → API / 页面渲染
```

## 2. 运行时组件

- **页面与 API**
  - `app/page.tsx`：SSR 首屏数据（`loadDashboardData(refreshMode="missing")`）。
  - `app/group/[groupName]/page.tsx`：分组详情页。
  - `app/api/dashboard/route.ts`：Dashboard 数据 API（ETag + CDN 缓存）。
  - `app/api/group/[groupName]/route.ts`：分组数据 API。
  - `app/api/v1/status/route.ts`：对外只读状态 API。

- **后台轮询器**
  - `lib/core/poller.ts`：定时执行检查与写入。
  - `lib/core/official-status-poller.ts`：轮询官方状态并缓存。

- **Supabase**
  - 表：`check_configs`、`check_history`、`group_info`、`system_notifications`。
  - 视图：`availability_stats`（7/15/30 天可用性统计）。
  - RPC：`get_recent_check_history`、`prune_check_history`。

## 3. 关键数据流

1. **配置加载**
   - `lib/database/config-loader.ts` 读取 `check_configs`（仅 `enabled = true`）。

2. **健康检查执行**
   - `lib/providers/ai-sdk-check.ts` 使用 Vercel AI SDK 调用模型。
   - 通过数学挑战验证响应，测量首 token 延迟。
   - `endpoint-ping.ts` 计算 Origin Ping 延迟。

3. **历史写入与裁剪**
   - `lib/database/history.ts` 负责写入 `check_history` 并调用 `prune_check_history`。
   - 若 RPC 缺失则回退到直连 SQL（性能降低）。

4. **快照与聚合**
   - `lib/core/health-snapshot-service.ts` 统一读取历史与触发刷新。
   - `lib/core/dashboard-data.ts`/`group-data.ts` 负责统计数据；Dashboard 分组逻辑已前移到客户端。返回完整时间线与可用性统计。

5. **对外输出**
   - Dashboard 页面与 API 均使用聚合数据结构（时间线、可用性统计）。

## 4. 模块边界

- `lib/core/`
  - 轮询器、选主逻辑、聚合与缓存、轮询配置解析。
- `lib/providers/`
  - `ai-sdk-check.ts`：统一的 Provider 检查入口。
  - `challenge.ts`：数学挑战验证。
  - `endpoint-ping.ts`：网络层 Ping。
- `lib/official-status/`
  - OpenAI / Anthropic 官方状态抓取与解析。
- `lib/database/`
  - 配置加载、历史读写、可用性视图、通知与分组信息。
- `components/`
  - Dashboard 与分组 UI、时间线、通知横幅等。

## 5. 数据模型与关系

- `check_configs` → `check_history`（`config_id` 外键）
- `check_configs.group_name` ↔ `group_info.group_name`（分组元数据）
- `system_notifications` 为前端横幅提供公告

## 6. 缓存与一致性策略

- **后端快照缓存**：`global-state.ts` 保存最近一次读取的历史快照与刷新时间。
- **前端缓存**：`frontend-cache.ts` 实现 SWR 风格缓存，并配合 `ETag`。
- **官方状态缓存**：`official-status-poller.ts` 使用内存 `Map` 缓存结果。

## 7. 本地单进程轮询

- 当前实现按单进程模式运行：活动实例会直接执行轮询与写入，不再依赖数据库租约选主。
- Dashboard/API 数据路径会显式确保轮询器被拉起，并在检测到空窗时补跑一轮。
- 若未来要恢复多节点部署，需要重新引入明确的去重/选主机制，而不是复用旧租约链路。

## 8. 关键约束

- `enabled = false` 的配置不会被轮询器读取。
- `is_maintenance = true` 会保留卡片并返回 `maintenance` 状态，但不执行实际检查。
- 若 RPC/视图未安装，聚合层会回退到简单查询，性能下降，应优先补齐迁移。

