import {Button} from "@/components/ui/button";
import {
  AdminCheckbox,
  AdminField,
  AdminInput,
  AdminPageIntro,
  AdminPanel,
  AdminSelect,
  AdminStatusBanner,
  AdminTextarea,
} from "@/components/admin/admin-primitives";
import {deleteConfigAction, upsertConfigAction} from "@/app/admin/actions";
import {requireAdminSession} from "@/lib/admin/auth";
import {ADMIN_PROVIDER_TYPES, loadAdminManagementData} from "@/lib/admin/data";
import {formatAdminTimestamp, formatJson, getAdminFeedback} from "@/lib/admin/view";

export const dynamic = "force-dynamic";

interface AdminConfigsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminConfigsPage({searchParams}: AdminConfigsPageProps) {
  await requireAdminSession();
  const [{configs, templates, groupNames}, params] = await Promise.all([
    loadAdminManagementData(),
    searchParams,
  ]);
  const feedback = getAdminFeedback(params);

  return (
    <div className="space-y-6">
      <AdminPageIntro
        eyebrow="Admin / Configs"
        title="检测配置管理"
        description="直接维护 `check_configs` 表中的 provider 配置。密钥只在服务端更新，页面不会回显已有值；留空即可保留现有 API Key。"
      />

      {feedback ? <AdminStatusBanner type={feedback.type} message={feedback.message} /> : null}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.45fr]">
        <AdminPanel
          title="新增配置"
          description="创建新的 provider 监控目标。模板用于复用请求头和 metadata，分组会决定首页上的归属。"
        >
          <form action={upsertConfigAction} className="space-y-4">
            <input type="hidden" name="returnTo" value="/admin/configs" />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <AdminField label="配置名称">
                <AdminInput name="name" placeholder="例如：OpenAI GPT-4o" required />
              </AdminField>

              <AdminField label="Provider 类型">
                <AdminSelect name="type" defaultValue="openai" required>
                  {ADMIN_PROVIDER_TYPES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </AdminSelect>
              </AdminField>

              <AdminField label="模型">
                <AdminInput name="model" placeholder="gpt-4o-mini" required />
              </AdminField>

              <AdminField label="接口地址" description="OpenAI 支持 /v1/chat/completions 和 /v1/responses；保存时会自动纠正常见拼写错误。">
                <AdminInput
                  name="endpoint"
                  placeholder="https://api.openai.com/v1/responses"
                  required
                />
              </AdminField>

              <AdminField label="分组名称" description="可直接填写新分组，或沿用已有分组名称。">
                <AdminInput name="group_name" list="admin-group-name-options" placeholder="OpenAI" />
              </AdminField>

              <AdminField label="关联模板">
                <AdminSelect name="template_id" defaultValue="">
                  <option value="">不使用模板</option>
                  {templates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.type}
                    </option>
                  ))}
                </AdminSelect>
              </AdminField>
            </div>

            <AdminField label="API Key" description="仅用于写入数据库，不会在页面上回显已有密钥。">
              <AdminInput name="api_key" type="password" placeholder="sk-..." required />
            </AdminField>

            <AdminField label="请求头覆盖(JSON)">
              <AdminTextarea
                name="request_header"
                placeholder='{"x-trace-source": "admin-console"}'
              />
            </AdminField>

            <AdminField label="元数据(JSON)">
              <AdminTextarea
                name="metadata"
                placeholder='{"region": "global", "tier": "paid"}'
              />
            </AdminField>

            <div className="grid gap-3 md:grid-cols-2">
              <AdminCheckbox
                name="enabled"
                defaultChecked
                label="启用配置"
                description="关闭后不会被轮询器加载。"
              />
              <AdminCheckbox
                name="is_maintenance"
                label="维护模式"
                description="开启后在首页中以维护状态展示。"
              />
            </div>

            <Button type="submit" className="w-full rounded-full">
              创建配置
            </Button>
          </form>
        </AdminPanel>

        <AdminPanel
          title="现有配置"
          description="对已有 provider 做增量修改。留空 API Key 时会保留数据库中原值。"
        >
          <div className="space-y-4">
            {configs.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm text-muted-foreground">
                当前还没有任何检测配置。
              </div>
            ) : (
              configs.map((config) => (
                <div
                  key={config.id}
                  className="rounded-[1.75rem] border border-border/40 bg-background/70 p-4 shadow-sm"
                >
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-medium text-foreground">{config.name}</h3>
                        <span className="rounded-full border border-border/40 bg-background/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                          {config.type}
                        </span>
                        {config.enabled ? (
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                            已启用
                          </span>
                        ) : (
                          <span className="rounded-full border border-border/40 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                            已停用
                          </span>
                        )}
                        {config.is_maintenance ? (
                          <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                            维护中
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        更新于 {formatAdminTimestamp(config.updated_at ?? config.created_at)}
                      </div>
                    </div>

                    <form action={deleteConfigAction}>
                      <input type="hidden" name="id" value={config.id} />
                      <input type="hidden" name="returnTo" value="/admin/configs" />
                      <Button
                        type="submit"
                        variant="outline"
                        className="rounded-full border-rose-500/20 text-rose-700 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-300"
                      >
                        删除配置
                      </Button>
                    </form>
                  </div>

                  <form action={upsertConfigAction} className="space-y-4">
                    <input type="hidden" name="id" value={config.id} />
                    <input type="hidden" name="returnTo" value="/admin/configs" />

                    <div className="grid gap-4 md:grid-cols-2">
                      <AdminField label="配置名称">
                        <AdminInput name="name" defaultValue={config.name} required />
                      </AdminField>

                      <AdminField label="Provider 类型">
                        <AdminSelect name="type" defaultValue={config.type} required>
                          {ADMIN_PROVIDER_TYPES.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </AdminSelect>
                      </AdminField>

                      <AdminField label="模型">
                        <AdminInput name="model" defaultValue={config.model} required />
                      </AdminField>

                      <AdminField label="接口地址">
                        <AdminInput name="endpoint" defaultValue={config.endpoint} required />
                      </AdminField>

                      <AdminField label="分组名称">
                        <AdminInput
                          name="group_name"
                          defaultValue={config.group_name ?? ""}
                          list="admin-group-name-options"
                        />
                      </AdminField>

                      <AdminField label="关联模板">
                        <AdminSelect name="template_id" defaultValue={config.template_id ?? ""}>
                          <option value="">不使用模板</option>
                          {templates.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · {item.type}
                            </option>
                          ))}
                        </AdminSelect>
                      </AdminField>
                    </div>

                    <AdminField
                      label="更新 API Key"
                      description="留空会保留当前数据库中的密钥值，不会把旧密钥重新回显到客户端。"
                    >
                      <AdminInput name="api_key" type="password" placeholder="留空保留现有密钥" />
                    </AdminField>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <AdminField label="请求头覆盖(JSON)">
                        <AdminTextarea
                          name="request_header"
                          defaultValue={formatJson(config.request_header)}
                        />
                      </AdminField>
                      <AdminField label="元数据(JSON)">
                        <AdminTextarea
                          name="metadata"
                          defaultValue={formatJson(config.metadata)}
                        />
                      </AdminField>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <AdminCheckbox
                        name="enabled"
                        defaultChecked={config.enabled}
                        label="启用配置"
                        description="关闭后不会参与轮询或首页渲染。"
                      />
                      <AdminCheckbox
                        name="is_maintenance"
                        defaultChecked={config.is_maintenance}
                        label="维护模式"
                        description="开启后以维护状态展示，但仍保留配置记录。"
                      />
                    </div>

                    <Button type="submit" className="rounded-full">
                      保存修改
                    </Button>
                  </form>
                </div>
              ))
            )}
          </div>
        </AdminPanel>
      </div>

      <datalist id="admin-group-name-options">
        {groupNames.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </div>
  );
}
