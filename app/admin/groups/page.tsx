import {Button} from "@/components/ui/button";
import {
  AdminField,
  AdminInput,
  AdminPageIntro,
  AdminPanel,
  AdminStatusBanner,
} from "@/components/admin/admin-primitives";
import {deleteGroupAction, upsertGroupAction} from "@/app/admin/actions";
import {requireAdminSession} from "@/lib/admin/auth";
import {loadAdminManagementData} from "@/lib/admin/data";
import {formatAdminTimestamp, getAdminFeedback} from "@/lib/admin/view";

export const dynamic = "force-dynamic";

interface AdminGroupsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminGroupsPage({searchParams}: AdminGroupsPageProps) {
  await requireAdminSession();
  const [{groups}, params] = await Promise.all([loadAdminManagementData(), searchParams]);
  const feedback = getAdminFeedback(params);

  return (
    <div className="space-y-6">
      <AdminPageIntro
        eyebrow="Admin / Groups"
        title="分组信息管理"
        description="维护 `group_info`，让首页与分组详情页共享统一的官网链接和标签文案。"
      />

      {feedback ? <AdminStatusBanner type={feedback.type} message={feedback.message} /> : null}

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.45fr]">
        <AdminPanel title="新增分组" description="分组名称应与配置中的 group_name 保持一致。">
          <form action={upsertGroupAction} className="space-y-4">
            <input type="hidden" name="returnTo" value="/admin/groups" />

            <AdminField label="分组名称">
              <AdminInput name="group_name" placeholder="OpenAI" required />
            </AdminField>

            <AdminField label="官网链接">
              <AdminInput name="website_url" placeholder="https://openai.com" />
            </AdminField>

            <AdminField label="标签" description="保持和首页展示一致，推荐逗号分隔。">
              <AdminInput name="tags" placeholder="全球, API, 主站" />
            </AdminField>

            <Button type="submit" className="w-full rounded-full">
              创建分组
            </Button>
          </form>
        </AdminPanel>

        <AdminPanel title="现有分组" description="更新后会影响首页分组卡片与分组详情页的显示信息。">
          <div className="space-y-4">
            {groups.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm text-muted-foreground">
                当前还没有任何分组信息。
              </div>
            ) : (
              groups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-[1.75rem] border border-border/40 bg-background/70 p-4 shadow-sm"
                >
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <h3 className="text-lg font-medium text-foreground">{group.group_name}</h3>
                      <div className="text-xs text-muted-foreground">
                        更新于 {formatAdminTimestamp(group.updated_at ?? group.created_at)}
                      </div>
                    </div>

                    <form action={deleteGroupAction}>
                      <input type="hidden" name="id" value={group.id} />
                      <input type="hidden" name="returnTo" value="/admin/groups" />
                      <Button
                        type="submit"
                        variant="outline"
                        className="rounded-full border-rose-500/20 text-rose-700 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-300"
                      >
                        删除分组
                      </Button>
                    </form>
                  </div>

                  <form action={upsertGroupAction} className="space-y-4">
                    <input type="hidden" name="id" value={group.id} />
                    <input type="hidden" name="returnTo" value="/admin/groups" />

                    <div className="grid gap-4 md:grid-cols-2">
                      <AdminField label="分组名称">
                        <AdminInput name="group_name" defaultValue={group.group_name} required />
                      </AdminField>

                      <AdminField label="官网链接">
                        <AdminInput name="website_url" defaultValue={group.website_url ?? ""} />
                      </AdminField>
                    </div>

                    <AdminField label="标签">
                      <AdminInput name="tags" defaultValue={group.tags ?? ""} />
                    </AdminField>

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
