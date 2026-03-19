import {Sparkles} from "lucide-react";

import {
  resetSiteIconAction,
  uploadSiteIconAction,
  upsertSiteSettingsAction,
} from "@/app/admin/actions";
import {
  AdminField,
  AdminInput,
  AdminPageIntro,
  AdminPanel,
  AdminStatusBanner,
  AdminTextarea,
} from "@/components/admin/admin-primitives";
import {Button} from "@/components/ui/button";
import {requireAdminSession} from "@/lib/admin/auth";
import {SITE_ICON_ACCEPT_ATTRIBUTE, SITE_ICON_MAX_BYTES, SITE_ICON_UPLOAD_FIELD_NAME} from "@/lib/site-icons";
import {getAdminFeedback} from "@/lib/admin/view";
import {loadSiteSettingsState} from "@/lib/site-settings";

export const dynamic = "force-dynamic";

interface AdminSettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminSettingsPage({searchParams}: AdminSettingsPageProps) {
  await requireAdminSession();
  const [params, settingsState] = await Promise.all([searchParams, loadSiteSettingsState()]);
  const feedback = getAdminFeedback(params);
  const {settings, warning, source} = settingsState;

  return (
    <div className="space-y-6">
      <AdminPageIntro
        eyebrow="Admin / Settings"
        title="站点设置"
        description="把站点名称、浏览器图标、首页 Hero 品牌文案、footer 品牌名和后台壳子标题统一收进一处。后续你想改品牌呈现，不需要再回到代码里改常量。"
      />

      {feedback ? <AdminStatusBanner type={feedback.type} message={feedback.message} /> : null}
      {warning ? <AdminStatusBanner type="error" message={warning} /> : null}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <AdminPanel
            title="上传站点图标"
            description="直接上传图标文件即可，系统会把文件保存到本地持久化目录，并自动生成浏览器标签页 / 侧栏图标所需地址。"
          >
            <div className="space-y-4">
              <div className="flex items-start gap-4 rounded-[1.5rem] border border-border/40 bg-background/70 p-4 shadow-sm">
                <div
                  aria-label="当前站点图标"
                  role="img"
                  className="h-12 w-12 rounded-2xl border border-border/40 bg-background bg-cover bg-center shadow-sm"
                  style={{backgroundImage: `url(${settings.siteIconUrl})`}}
                />
                <div className="min-w-0 space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">当前图标</p>
                  <p className="break-all">{settings.siteIconUrl}</p>
                  <p>上传后会自动替换，不需要手动输入路径。</p>
                </div>
              </div>

              <form action={uploadSiteIconAction} className="space-y-4">
                <input type="hidden" name="returnTo" value="/admin/settings" />
                <AdminField
                  label="上传图标文件"
                  description={`支持 PNG / ICO / WEBP / JPEG，最大 ${Math.floor(SITE_ICON_MAX_BYTES / 1024 / 1024)} MB。上传后会自动应用到浏览器标签页与侧栏图标。`}
                >
                  <AdminInput
                    type="file"
                    name={SITE_ICON_UPLOAD_FIELD_NAME}
                    accept={SITE_ICON_ACCEPT_ATTRIBUTE}
                    required
                  />
                </AdminField>

                <Button type="submit" className="w-full rounded-full">
                  上传并应用图标
                </Button>
              </form>

              <form action={resetSiteIconAction}>
                <input type="hidden" name="returnTo" value="/admin/settings" />
                <Button type="submit" variant="outline" className="w-full rounded-full">
                  恢复默认图标
                </Button>
              </form>
            </div>
          </AdminPanel>

          <AdminPanel
            title="编辑全局品牌设置"
            description="这些设置会影响浏览器标题、首页主视觉、footer，以及后台壳子的品牌呈现。图标上传在上方单独管理。"
          >
            <form action={upsertSiteSettingsAction} className="space-y-4">
              <input type="hidden" name="returnTo" value="/admin/settings" />

              <div className="grid gap-4 md:grid-cols-2">
                <AdminField label="站点名称" description="用于浏览器标题和部分全局品牌展示。">
                  <AdminInput name="site_name" defaultValue={settings.siteName} required />
                </AdminField>

                <AdminField label="Footer 品牌名" description="用于首页底部版权区域。">
                  <AdminInput name="footer_brand" defaultValue={settings.footerBrand} required />
                </AdminField>

                <AdminField label="Hero 徽标文案" description="首页标题上方的小型胶囊标签。">
                  <AdminInput name="hero_badge" defaultValue={settings.heroBadge} required />
                </AdminField>

                <AdminField label="后台标题" description="显示在后台左侧壳子的主标题。">
                  <AdminInput
                    name="admin_console_title"
                    defaultValue={settings.adminConsoleTitle}
                    required
                  />
                </AdminField>

                <AdminField label="Hero 标题主行">
                  <AdminInput
                    name="hero_title_primary"
                    defaultValue={settings.heroTitlePrimary}
                    required
                  />
                </AdminField>

                <AdminField label="Hero 标题副行">
                  <AdminInput
                    name="hero_title_secondary"
                    defaultValue={settings.heroTitleSecondary}
                    required
                  />
                </AdminField>
              </div>

              <AdminField label="站点描述" description="用于 metadata description 与分组页衍生描述。">
                <AdminTextarea
                  name="site_description"
                  defaultValue={settings.siteDescription}
                  required
                />
              </AdminField>

              <AdminField label="首页 Hero 描述" description="支持换行，适合一中一英两行品牌说明。">
                <AdminTextarea
                  name="hero_description"
                  defaultValue={settings.heroDescription}
                  required
                />
              </AdminField>

              <AdminField label="后台描述" description="显示在后台壳子标题下方。">
                <AdminTextarea
                  name="admin_console_description"
                  defaultValue={settings.adminConsoleDescription}
                  required
                />
              </AdminField>

              <Button type="submit" className="w-full rounded-full">
                保存站点设置
              </Button>
            </form>
          </AdminPanel>
        </div>

        <AdminPanel
          title="当前效果预览"
          description="这里不是像素级完整预览，而是把几个最关键的品牌位集中出来，方便你保存前快速核对。"
          trailing={<Sparkles className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="space-y-4">
            <div className="rounded-[1.75rem] border border-border/40 bg-background/70 p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
                Browser Title
              </div>
              <div className="mt-3 flex items-center gap-3 text-2xl font-semibold tracking-[-0.05em] text-foreground">
                <div
                  aria-label="站点图标预览"
                  role="img"
                  className="h-9 w-9 rounded-xl border border-border/40 bg-background bg-cover bg-center shadow-sm"
                  style={{backgroundImage: `url(${settings.siteIconUrl})`}}
                />
                <span>{settings.siteName}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{settings.siteDescription}</p>
              <p className="mt-2 text-xs text-muted-foreground">当前图标：{settings.siteIconUrl}</p>
            </div>

            <div className="rounded-[1.75rem] border border-border/40 bg-background/70 p-5 shadow-sm">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.26em] text-muted-foreground">
                {settings.heroBadge}
              </div>
              <div className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">
                {settings.heroTitlePrimary}
                <br />
                <span className="text-muted-foreground">{settings.heroTitleSecondary}</span>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-7 text-muted-foreground">
                {settings.heroDescription}
              </p>
            </div>

            <div className="rounded-[1.75rem] border border-border/40 bg-background/70 p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
                Admin Shell
              </div>
              <div className="mt-3 text-xl font-semibold tracking-[-0.04em] text-foreground">
                {settings.adminConsoleTitle}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {settings.adminConsoleDescription}
              </p>
              <div className="mt-3 text-xs text-muted-foreground">
                当前来源：{source === "database" ? "数据库配置" : "默认回退配置"}
              </div>
            </div>
          </div>
        </AdminPanel>
      </div>
    </div>
  );
}
