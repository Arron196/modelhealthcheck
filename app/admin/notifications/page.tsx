import {Button} from "@/components/ui/button";
import {
  AdminCheckbox,
  AdminField,
  AdminPageIntro,
  AdminPanel,
  AdminSelect,
  AdminStatusBanner,
  AdminTextarea,
} from "@/components/admin/admin-primitives";
import {deleteNotificationAction, upsertNotificationAction} from "@/app/admin/actions";
import {requireAdminSession} from "@/lib/admin/auth";
import {ADMIN_NOTIFICATION_LEVELS, loadAdminManagementData} from "@/lib/admin/data";
import {formatAdminTimestamp, getAdminFeedback, getStatusToneClass} from "@/lib/admin/view";
import {cn} from "@/lib/utils";

export const dynamic = "force-dynamic";

interface AdminNotificationsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminNotificationsPage({
  searchParams,
}: AdminNotificationsPageProps) {
  await requireAdminSession();
  const [{notifications}, params] = await Promise.all([
    loadAdminManagementData(),
    searchParams,
  ]);
  const feedback = getAdminFeedback(params);

  return (
    <div className="space-y-6">
      <AdminPageIntro
        title="系统通知"
        description="管理首页顶部横幅。"
      />

      {feedback ? <AdminStatusBanner type={feedback.type} message={feedback.message} /> : null}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.4fr]">
        <AdminPanel title="新增通知" description="创建一条新通知。">
          <form action={upsertNotificationAction} className="space-y-4">
            <input type="hidden" name="returnTo" value="/admin/notifications" />

            <AdminField label="通知内容">
              <AdminTextarea name="message" placeholder="请在这里填写 Markdown 文案" required />
            </AdminField>

            <AdminField label="通知级别">
              <AdminSelect name="level" defaultValue="info" required>
                {ADMIN_NOTIFICATION_LEVELS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </AdminSelect>
            </AdminField>

            <AdminCheckbox
              name="is_active"
              defaultChecked
              label="立即启用"
              description="关闭后依然保留内容，但不会出现在公开页面。"
            />

            <Button type="submit" className="w-full rounded-full">
              创建通知
            </Button>
          </form>
        </AdminPanel>

        <AdminPanel title="现有通知" description="编辑或停用已有通知。">
          <div className="space-y-4">
            {notifications.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm text-muted-foreground">
                当前还没有任何系统通知。
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="rounded-[1.75rem] border border-border/40 bg-background/70 p-4 shadow-sm"
                >
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ring-1",
                            getStatusToneClass(notification.level)
                          )}
                        >
                          {notification.level}
                        </span>
                        {notification.is_active ? (
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                            已启用
                          </span>
                        ) : (
                          <span className="rounded-full border border-border/40 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                            已停用
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        创建于 {formatAdminTimestamp(notification.created_at)}
                      </div>
                    </div>

                    <form action={deleteNotificationAction}>
                      <input type="hidden" name="id" value={notification.id} />
                      <input type="hidden" name="returnTo" value="/admin/notifications" />
                      <Button
                        type="submit"
                        variant="outline"
                        className="rounded-full border-rose-500/20 text-rose-700 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-300"
                      >
                        删除通知
                      </Button>
                    </form>
                  </div>

                  <form action={upsertNotificationAction} className="space-y-4">
                    <input type="hidden" name="id" value={notification.id} />
                    <input type="hidden" name="returnTo" value="/admin/notifications" />

                    <AdminField label="通知内容">
                      <AdminTextarea name="message" defaultValue={notification.message} required />
                    </AdminField>

                    <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
                      <AdminField label="通知级别">
                        <AdminSelect name="level" defaultValue={notification.level} required>
                          {ADMIN_NOTIFICATION_LEVELS.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </AdminSelect>
                      </AdminField>

                      <AdminCheckbox
                        name="is_active"
                        defaultChecked={notification.is_active}
                        label="启用通知"
                        description="取消勾选后会从公开页面的通知接口中移除。"
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
    </div>
  );
}
