import {ArrowRight, BellRing, Boxes, Database, FolderTree, HardDrive, Layers3, Settings2} from "lucide-react";
import Link from "next/link";

import {AdminPanel, AdminStatCard} from "@/components/admin/admin-primitives";
import {requireAdminSession} from "@/lib/admin/auth";
import {loadAdminManagementData} from "@/lib/admin/data";
import {formatAdminTimestamp, getStatusToneClass} from "@/lib/admin/view";
import {cn} from "@/lib/utils";

export const dynamic = "force-dynamic";

const SECTION_LINKS = [
  {
    href: "/admin/configs",
    label: "检测配置",
    summary: "配置、模型、地址、开关。",
    icon: Boxes,
  },
  {
    href: "/admin/templates",
    label: "请求模板",
    summary: "请求头和附加参数。",
    icon: Layers3,
  },
  {
    href: "/admin/groups",
    label: "分组信息",
    summary: "站点链接与标签。",
    icon: FolderTree,
  },
  {
    href: "/admin/notifications",
    label: "系统通知",
    summary: "横幅文案和状态。",
    icon: BellRing,
  },
  {
    href: "/admin/storage",
    label: "存储诊断",
    summary: "后端状态和健康信息。",
    icon: HardDrive,
  },
  {
    href: "/admin/supabase",
    label: "Supabase 检查",
    summary: "Supabase 环境和修复信息。",
    icon: Database,
  },
  {
    href: "/admin/settings",
    label: "站点设置",
    summary: "名称、文案和标题。",
    icon: Settings2,
  },
] as const;

export default async function AdminOverviewPage() {
  await requireAdminSession();
  const {overview} = await loadAdminManagementData();

  return (
    <div className="space-y-6">
      <section className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-[-0.05em] text-foreground sm:text-4xl">
          总览
        </h1>
        <p className="mx-auto max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          查看状态、数量和入口。
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AdminStatCard
          label="检测配置"
          value={overview.configCount}
          helper={`启用 ${overview.enabledConfigCount} 条，维护 ${overview.maintenanceCount} 条`}
        />
        <AdminStatCard
          label="请求模板"
          value={overview.templateCount}
          helper="复用请求头和附加参数"
        />
        <AdminStatCard
          label="分组信息"
          value={overview.groupCount}
          helper="首页和分组页使用"
        />
        <AdminStatCard
          label="活跃通知"
          value={overview.activeNotificationCount}
          helper="首页横幅数量"
        />
        <AdminStatCard
          label="最近巡检"
          value={formatAdminTimestamp(overview.lastCheckedAt)}
          helper="最近更新时间"
        />
        <AdminStatCard
          label="状态维度"
          value={overview.statusBreakdown.length}
          helper="按状态汇总"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <AdminPanel
          title="状态"
          description="最近一次检查结果。"
        >
          <div className="space-y-3">
            {overview.latestStatuses.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm text-muted-foreground">
                暂无记录。
              </div>
            ) : (
              overview.latestStatuses.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-[1.5rem] border border-border/40 bg-gradient-to-br from-background/90 to-background/65 px-4 py-4 shadow-sm transition hover:border-cyan-500/30 hover:shadow-md hover:shadow-cyan-500/10 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
                          getStatusToneClass(item.status)
                        )}
                      >
                        {item.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.groupName ? `${item.groupName} · ` : ""}
                      {formatAdminTimestamp(item.checkedAt)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </AdminPanel>

        <AdminPanel
          title="入口"
          description="打开常用页面。"
        >
          <div className="space-y-3">
            {SECTION_LINKS.map((item) => {
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex items-start justify-between gap-3 rounded-[1.5rem] border border-border/40 bg-gradient-to-br from-background/90 to-background/65 px-4 py-4 transition duration-200 hover:border-cyan-500/30 hover:shadow-md hover:shadow-cyan-500/10"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/40 bg-background/90 text-muted-foreground transition group-hover:text-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-foreground">{item.label}</div>
                      <p className="text-xs leading-5 text-muted-foreground">{item.summary}</p>
                    </div>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                </Link>
              );
            })}
          </div>
        </AdminPanel>
      </div>
    </div>
  );
}
