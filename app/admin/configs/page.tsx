import Link from "next/link";

import {Button} from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {deleteConfigAction, manageConfigsAction, upsertConfigAction} from "@/app/admin/actions";
import {requireAdminSession} from "@/lib/admin/auth";
import {ADMIN_PROVIDER_TYPES, loadAdminManagementData} from "@/lib/admin/data";
import {formatAdminTimestamp, formatJson, getAdminFeedback} from "@/lib/admin/view";

export const dynamic = "force-dynamic";

interface AdminConfigsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getSingleParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export default async function AdminConfigsPage({searchParams}: AdminConfigsPageProps) {
  await requireAdminSession();
  const [{configs, templates, groupNames}, params] = await Promise.all([
    loadAdminManagementData(),
    searchParams,
  ]);
  const feedback = getAdminFeedback(params);
  const editingId = getSingleParam(params.edit);
  const editingConfig = editingId ? configs.find((config) => config.id === editingId) ?? null : null;

  return (
    <div className="space-y-6">
      <AdminPageIntro
        title="检测配置"
        description="模型字段支持一次填写多个模型，系统会自动拆分成多条同设置配置。现有配置统一放在下方表格里，支持多选批量管理。"
      />

      {feedback ? <AdminStatusBanner type={feedback.type} message={feedback.message} /> : null}

      <AdminPanel
        title="新增配置"
        description="模型可用逗号、顿号、分号或换行分隔；提交后会按模型自动生成多条检测配置。"
      >
        <form action={upsertConfigAction} className="space-y-4">
          <input type="hidden" name="returnTo" value="/admin/configs" />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AdminField label="配置名称">
              <AdminInput name="name" placeholder="例如：OpenAI 主线路" required />
            </AdminField>

            <AdminField label="服务类型">
              <AdminSelect name="type" defaultValue="openai" required>
                {ADMIN_PROVIDER_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </AdminSelect>
            </AdminField>

            <AdminField label="分组名称" description="可填写新分组，也可复用已有分组。">
              <AdminInput name="group_name" list="admin-group-name-options" placeholder="OpenAI" />
            </AdminField>

            <AdminField label="模型" description="支持多个模型，按逗号、分号、顿号或换行分隔。">
              <AdminTextarea
                name="model"
                placeholder={"gpt-4o-mini\ngpt-4.1-mini"}
                required
                className="min-h-[120px]"
              />
            </AdminField>

            <AdminField label="接口地址" description="保存时会自动纠正常见格式问题。">
              <AdminInput
                name="endpoint"
                placeholder="https://api.openai.com/v1/responses"
                required
              />
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

          <AdminField label="密钥" description="已有密钥不会在页面上显示。">
            <AdminInput name="api_key" type="password" placeholder="请输入密钥" required />
          </AdminField>

          <div className="grid gap-4 xl:grid-cols-2">
            <AdminField label="请求头(JSON)">
              <AdminTextarea
                name="request_header"
                placeholder='{"x-trace-source": "site"}'
              />
            </AdminField>

            <AdminField label="附加参数(JSON)">
              <AdminTextarea
                name="metadata"
                placeholder='{"region": "global", "tier": "paid"}'
              />
            </AdminField>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:max-w-xl">
            <AdminCheckbox
              name="enabled"
              defaultChecked
              label="启用配置"
              description="关闭后不会参与检查。"
            />
            <AdminCheckbox
              name="is_maintenance"
              label="维护模式"
              description="开启后显示为维护中。"
            />
          </div>

          <Button type="submit" className="w-full rounded-full sm:w-auto">
            创建配置
          </Button>
        </form>
      </AdminPanel>

      <AdminPanel
        title="现有配置"
        description="表格支持多选批量启用、停用、维护和删除；单条配置可进入下方编辑区修改。"
      >
        {configs.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm text-muted-foreground">
            当前还没有任何检测配置。
          </div>
        ) : (
          <form action={manageConfigsAction} className="space-y-4">
            <input type="hidden" name="returnTo" value="/admin/configs" />

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm text-muted-foreground">
                共 {configs.length} 条配置，最近更新优先显示。
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <AdminSelect name="batch_action" defaultValue="enable" className="sm:w-48">
                  <option value="enable">批量启用</option>
                  <option value="disable">批量停用</option>
                  <option value="maintenance_on">批量设为维护中</option>
                  <option value="maintenance_off">批量取消维护</option>
                  <option value="delete">批量删除</option>
                </AdminSelect>
                <Button type="submit" variant="outline" className="rounded-full">
                  执行批量操作
                </Button>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-border/50 bg-background/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">选择</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead>分组</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>更新时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {configs.map((config) => (
                    <TableRow key={config.id}>
                      <TableCell className="w-12">
                        <input
                          type="checkbox"
                          name="selected_ids"
                          value={config.id}
                          className="h-4 w-4 rounded border-border/60"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">{config.name}</div>
                          <div className="max-w-[22rem] truncate text-xs text-muted-foreground">
                            {config.endpoint}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="uppercase text-muted-foreground">{config.type}</TableCell>
                      <TableCell className="font-mono text-xs text-foreground">{config.model}</TableCell>
                      <TableCell>{config.group_name ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <span
                            className={config.enabled
                              ? "rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
                              : "rounded-full border border-border/40 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"}
                          >
                            {config.enabled ? "已启用" : "已停用"}
                          </span>
                          {config.is_maintenance ? (
                            <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                              维护中
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatAdminTimestamp(config.updated_at ?? config.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/admin/configs?edit=${config.id}`}
                            className="inline-flex items-center justify-center rounded-full border border-border/50 px-3 py-2 text-sm text-foreground transition hover:bg-muted/70"
                          >
                            编辑
                          </Link>
                          <button
                            type="submit"
                            name="id"
                            value={config.id}
                            formAction={deleteConfigAction}
                            className="inline-flex items-center justify-center rounded-full border border-rose-500/20 px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-500/10 dark:text-rose-300"
                          >
                            删除
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </form>
        )}
      </AdminPanel>

      {editingConfig ? (
        <AdminPanel
          title={`编辑配置 · ${editingConfig.name}`}
          description="修改当前配置；如果模型里填写多个值，会保留当前配置并自动新增其余模型配置。"
        >
          <form action={upsertConfigAction} className="space-y-4">
            <input type="hidden" name="id" value={editingConfig.id} />
            <input type="hidden" name="returnTo" value="/admin/configs" />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <AdminField label="配置名称">
                <AdminInput name="name" defaultValue={editingConfig.name} required />
              </AdminField>

              <AdminField label="服务类型">
                <AdminSelect name="type" defaultValue={editingConfig.type} required>
                  {ADMIN_PROVIDER_TYPES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </AdminSelect>
              </AdminField>

              <AdminField label="分组名称">
                <AdminInput
                  name="group_name"
                  defaultValue={editingConfig.group_name ?? ""}
                  list="admin-group-name-options"
                />
              </AdminField>

              <AdminField label="模型" description="支持多个模型，额外模型会自动复制成新配置。">
                <AdminTextarea
                  name="model"
                  defaultValue={editingConfig.model}
                  required
                  className="min-h-[120px]"
                />
              </AdminField>

              <AdminField label="接口地址">
                <AdminInput name="endpoint" defaultValue={editingConfig.endpoint} required />
              </AdminField>

              <AdminField label="关联模板">
                <AdminSelect name="template_id" defaultValue={editingConfig.template_id ?? ""}>
                  <option value="">不使用模板</option>
                  {templates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.type}
                    </option>
                  ))}
                </AdminSelect>
              </AdminField>
            </div>

            <AdminField label="更新密钥" description="留空则保留现有密钥。">
              <AdminInput name="api_key" type="password" placeholder="留空保留现有密钥" />
            </AdminField>

            <div className="grid gap-4 xl:grid-cols-2">
              <AdminField label="请求头(JSON)">
                <AdminTextarea
                  name="request_header"
                  defaultValue={formatJson(editingConfig.request_header)}
                />
              </AdminField>
              <AdminField label="附加参数(JSON)">
                <AdminTextarea
                  name="metadata"
                  defaultValue={formatJson(editingConfig.metadata)}
                />
              </AdminField>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:max-w-xl">
              <AdminCheckbox
                name="enabled"
                defaultChecked={editingConfig.enabled}
                label="启用配置"
                description="关闭后不会参与检查。"
              />
              <AdminCheckbox
                name="is_maintenance"
                defaultChecked={editingConfig.is_maintenance}
                label="维护模式"
                description="开启后显示为维护中。"
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" className="rounded-full">
                保存修改
              </Button>
              <Link
                href="/admin/configs"
                className="inline-flex items-center justify-center rounded-full border border-border/50 px-4 py-2 text-sm text-foreground transition hover:bg-muted/70"
              >
                取消编辑
              </Link>
            </div>
          </form>
        </AdminPanel>
      ) : null}

      <datalist id="admin-group-name-options">
        {groupNames.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </div>
  );
}
