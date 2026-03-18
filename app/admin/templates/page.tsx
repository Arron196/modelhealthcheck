import {Button} from "@/components/ui/button";
import {
  AdminField,
  AdminInput,
  AdminPageIntro,
  AdminPanel,
  AdminSelect,
  AdminStatusBanner,
  AdminTextarea,
} from "@/components/admin/admin-primitives";
import {deleteTemplateAction, upsertTemplateAction} from "@/app/admin/actions";
import {requireAdminSession} from "@/lib/admin/auth";
import {ADMIN_PROVIDER_TYPES, loadAdminManagementData} from "@/lib/admin/data";
import {formatAdminTimestamp, formatJson, getAdminFeedback} from "@/lib/admin/view";

export const dynamic = "force-dynamic";

interface AdminTemplatesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminTemplatesPage({searchParams}: AdminTemplatesPageProps) {
  await requireAdminSession();
  const [{templates}, params] = await Promise.all([loadAdminManagementData(), searchParams]);
  const feedback = getAdminFeedback(params);

  return (
    <div className="space-y-6">
      <AdminPageIntro
        eyebrow="Admin / Templates"
        title="请求模板管理"
        description="直接维护 `check_request_templates`，把通用 header / metadata 沉淀成模板，再挂到具体 provider 配置上。"
      />

      {feedback ? <AdminStatusBanner type={feedback.type} message={feedback.message} /> : null}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.4fr]">
        <AdminPanel title="新增模板" description="适合放置可复用的 provider 级请求头或 metadata。">
          <form action={upsertTemplateAction} className="space-y-4">
            <input type="hidden" name="returnTo" value="/admin/templates" />

            <AdminField label="模板名称">
              <AdminInput name="name" placeholder="OpenAI Default Header" required />
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

            <AdminField label="请求头(JSON)">
              <AdminTextarea name="request_header" placeholder='{"x-foo": "bar"}' />
            </AdminField>

            <AdminField label="元数据(JSON)">
              <AdminTextarea name="metadata" placeholder='{"team": "core"}' />
            </AdminField>

            <Button type="submit" className="w-full rounded-full">
              创建模板
            </Button>
          </form>
        </AdminPanel>

        <AdminPanel title="现有模板" description="更改模板后，关联配置会在下一次读取时自动合并到请求参数中。">
          <div className="space-y-4">
            {templates.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm text-muted-foreground">
                当前还没有任何请求模板。
              </div>
            ) : (
              templates.map((template) => (
                <div
                  key={template.id}
                  className="rounded-[1.75rem] border border-border/40 bg-background/70 p-4 shadow-sm"
                >
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-medium text-foreground">{template.name}</h3>
                        <span className="rounded-full border border-border/40 bg-background/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                          {template.type}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        更新于 {formatAdminTimestamp(template.updated_at ?? template.created_at)}
                      </div>
                    </div>

                    <form action={deleteTemplateAction}>
                      <input type="hidden" name="id" value={template.id} />
                      <input type="hidden" name="returnTo" value="/admin/templates" />
                      <Button
                        type="submit"
                        variant="outline"
                        className="rounded-full border-rose-500/20 text-rose-700 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-300"
                      >
                        删除模板
                      </Button>
                    </form>
                  </div>

                  <form action={upsertTemplateAction} className="space-y-4">
                    <input type="hidden" name="id" value={template.id} />
                    <input type="hidden" name="returnTo" value="/admin/templates" />

                    <div className="grid gap-4 md:grid-cols-2">
                      <AdminField label="模板名称">
                        <AdminInput name="name" defaultValue={template.name} required />
                      </AdminField>

                      <AdminField label="Provider 类型">
                        <AdminSelect name="type" defaultValue={template.type} required>
                          {ADMIN_PROVIDER_TYPES.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </AdminSelect>
                      </AdminField>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <AdminField label="请求头(JSON)">
                        <AdminTextarea
                          name="request_header"
                          defaultValue={formatJson(template.request_header)}
                        />
                      </AdminField>

                      <AdminField label="元数据(JSON)">
                        <AdminTextarea
                          name="metadata"
                          defaultValue={formatJson(template.metadata)}
                        />
                      </AdminField>
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
    </div>
  );
}
