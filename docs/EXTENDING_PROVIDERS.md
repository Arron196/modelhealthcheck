# 扩展 Provider 与官方状态

本文档说明如何在当前架构下新增 Provider 类型或接入官方状态检查。请先评估是否真的需要新增类型：

- 若目标服务兼容 OpenAI Chat/Responses 接口，可直接使用 `type = openai` 并配置对应 `endpoint`，无需新增代码。
- 仅当接口协议与现有 Provider 明显不同，才需要新增 Provider 类型。

## 1. 扩展 Provider 类型

### 1.1 先判断你当前跑在哪个后端上

当前仓库支持三种控制面后端：

- **Supabase**：`check_configs.type` 仍受 Supabase schema / enum 约束
- **直连 Postgres**：控制面表结构由应用自动创建，`check_configs.type` 是 `text`
- **SQLite**：控制面表结构由应用自动创建，`check_configs.type` 也是 `text`

这意味着“新增 Provider 必须改数据库枚举”只对 **Supabase 路径**成立，不是所有部署模式都必须做的第一步。

### 1.2 Supabase 路径下的数据库修改

如果你要在 **Supabase** 后端中正式支持新 Provider，需要同步更新数据库定义：

- `supabase/schema.sql`
- 必要时同步 `supabase/schema-dev.sql`
- 新建迁移：`ALTER TYPE public.provider_type ADD VALUE ...`

如果你的部署只使用 SQLite / 直连 Postgres 控制面，本节不是强制前置步骤。

### 1.3 类型与 UI 标识

修改以下文件：

- `lib/types/provider.ts`：扩展 `ProviderType` 与 `DEFAULT_ENDPOINTS`
- `lib/core/status.ts`：补充 `PROVIDER_LABEL`
- `components/provider-icon.tsx`：为新 Provider 提供图标（或明确使用占位图标）

## 2. 实现健康检查

健康检查由 `lib/providers/ai-sdk-check.ts` 统一负责。

步骤：

1. 在 `createModel` 中新增 `case`，返回 AI SDK 模型实例。
2. 选择合适的 Provider SDK（如 `@ai-sdk/openai-compatible`）。
3. 如需自定义请求头与请求体参数，使用已有的 `request_header` 与 `metadata` 机制。

示例结构（仅示意）：

```ts
case "myvendor": {
  const provider = createOpenAICompatible({
    name: "myvendor",
    apiKey: config.apiKey,
    baseURL,
    fetch: customFetch,
  });
  return { model: provider(modelId), reasoningEffort: undefined, isResponses: false };
}
```

如果 Provider 不支持流式输出或行为异常，请直接在 `ai-sdk-check.ts` 内处理错误与超时分支，保持返回结构不变。

## 3. 官方状态检查（可选）

官方状态检查位于 `lib/official-status/`。

步骤：

1. 新增 `lib/official-status/<provider>.ts`，实现 `check<Provider>Status()`。
2. 在 `lib/official-status/index.ts` 注册新方法。
3. 在 `lib/core/official-status-poller.ts` 的 `allTypes` 列表中加入新类型。

## 4. 数据库配置

新增 Provider 后，插入配置：

```sql
INSERT INTO check_configs (name, type, model, endpoint, api_key, enabled)
VALUES ('MyVendor 主力', 'myvendor', 'my-model', 'https://api.myvendor.com/v1/chat/completions', 'sk-xxx', true);
```

## 5. 验证清单

- 确认后台配置页能创建 / 编辑新 Provider
- 轮询日志出现新 Provider 记录
- Dashboard 卡片可见并显示延迟
- 官方状态（若已实现）显示正确
- 状态 API `GET /api/v1/status` 返回新 Provider

## 6. 注意事项

- 如果你要让新 Provider 在 **Supabase** 与 **SQLite / Postgres** 三种模式下都可用，除了代码分支外，还要同步更新所有文档与环境示例，避免只在某一个后端里可配置。
- 如果目标服务兼容 OpenAI Chat / Responses 协议，优先复用 `type = openai`，通常不值得为了“品牌名不同”单独新增一种 Provider。

