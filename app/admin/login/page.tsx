import Link from "next/link";

import {
  AdminField,
  AdminInput,
  AdminPageIntro,
  AdminPanel,
  AdminStatusBanner,
} from "@/components/admin/admin-primitives";
import {TurnstileWidget} from "@/components/admin/turnstile-widget";
import {Button} from "@/components/ui/button";
import {bootstrapAdminAction, loginAdminAction} from "@/app/admin/actions";
import {ensureLoggedOutForLoginPage, getTurnstileSiteKey, hasAdminUsers, isTurnstileEnabled} from "@/lib/admin/auth";
import {getAdminFeedback} from "@/lib/admin/view";

export const dynamic = "force-dynamic";

interface AdminLoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminLoginPage({searchParams}: AdminLoginPageProps) {
  await ensureLoggedOutForLoginPage();

  const params = await searchParams;
  const feedback = getAdminFeedback(params);
  const turnstileSiteKey = getTurnstileSiteKey();
  const turnstileEnabled = isTurnstileEnabled();
  let adminExists = false;
  let availabilityError: string | null = null;

  try {
    adminExists = await hasAdminUsers();
  } catch (error) {
    availabilityError =
      error instanceof Error && error.message.trim()
        ? error.message
        : "当前无法连接管理员账户存储，请确认所选数据库后端已正确配置。";
  }

  return (
    <div className="min-h-screen py-8 md:py-16">
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 sm:gap-8 sm:px-6 lg:px-12">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border/40 bg-background/60 px-4 py-1.5 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition hover:border-border/80 hover:text-foreground"
        >
          返回首页
        </Link>

        <AdminPageIntro
          eyebrow={adminExists ? "Admin / Login" : "Admin / Bootstrap"}
          title={adminExists ? "管理员登录" : "初始化管理员账户"}
          description={
            adminExists
              ? "后台已启用基础账号密码登录。完成验证后即可进入控制台，继续使用与主站一致的界面风格管理配置。"
              : "这是后台第一次启用。先创建首个管理员账户，创建成功后会自动登录并进入后台控制台。"
          }
        />

        {feedback ? <AdminStatusBanner type={feedback.type} message={feedback.message} /> : null}

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <AdminPanel
            title={adminExists ? "登录后台" : "创建首个管理员"}
            description={
              adminExists
                ? "请输入管理员用户名和密码。"
                : "首次创建完成后，后续访问 `/admin` 会直接进入登录流程。"
            }
          >
            {availabilityError ? (
              <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm leading-7 text-muted-foreground">
                {availabilityError}
              </div>
            ) : (
              <form action={adminExists ? loginAdminAction : bootstrapAdminAction} className="space-y-4">
                <AdminField label="用户名" description="推荐使用统一的小写标识，例如 admin.core。">
                  <AdminInput name="username" placeholder="admin.core" required />
                </AdminField>

                <AdminField label="密码">
                  <AdminInput name="password" type="password" placeholder="至少 8 位" required />
                </AdminField>

                {adminExists ? null : (
                  <AdminField label="确认密码">
                    <AdminInput
                      name="confirm_password"
                      type="password"
                      placeholder="再次输入密码"
                      required
                    />
                  </AdminField>
                )}

                <TurnstileWidget
                  action={adminExists ? "login" : "admin_bootstrap"}
                  siteKey={turnstileSiteKey}
                />

                <Button type="submit" className="w-full rounded-full">
                  {adminExists ? "登录后台" : "创建管理员并进入后台"}
                </Button>
              </form>
            )}
          </AdminPanel>

          <AdminPanel
            title="安全说明"
            description="保持最小实现，但把关键安全边界补齐。"
          >
            <div className="space-y-4 text-sm leading-7 text-muted-foreground">
              <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm">
                会话使用服务端签名 cookie 保存，密码仅以哈希形式存储在数据库中。
              </div>
              <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm">
                检测配置、模板、分组和通知的写操作仍然全部走服务端 action，不会把敏感密钥回传到客户端。
              </div>
              <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm">
                {turnstileEnabled
                  ? "当前环境已启用 Cloudflare Turnstile，登录与首次初始化都需要通过挑战验证。"
                  : "当前环境未配置 Turnstile key，登录流程仍可使用；补齐站点 key 与 secret 后会自动启用人机验证。"}
              </div>
            </div>
          </AdminPanel>
        </div>
      </main>
    </div>
  );
}
