import {ArrowRight, BellRing, Boxes, Database, FolderTree, HardDrive, Layers3, Settings2} from "lucide-react";
import Link from "next/link";

import {AdminActionLink, AdminPageIntro, AdminPanel, AdminStatCard} from "@/components/admin/admin-primitives";
import {requireAdminSession} from "@/lib/admin/auth";
import {loadAdminManagementData} from "@/lib/admin/data";
import {formatAdminTimestamp, getStatusToneClass} from "@/lib/admin/view";
import {cn} from "@/lib/utils";

export const dynamic = "force-dynamic";

const SECTION_LINKS = [
  {
    href: "/admin/configs",
    label: "检测配置",
    summary: "管理 provider、模型、接口地址、分组和运行开关。",
    icon: Boxes,
  },
  {
    href: "/admin/templates",
    label: "请求模板",
    summary: "复用请求头和 metadata，减少配置散落。",
    icon: Layers3,
  },
  {
    href: "/admin/groups",
    label: "分组信息",
    summary: "统一维护分组官网链接与标签展示。",
    icon: FolderTree,
  },
  {
    href: "/admin/notifications",
    label: "系统通知",
    summary: "控制首页横幅公告的文案和显示状态。",
    icon: BellRing,
  },
  {
    href: "/admin/storage",
    label: "存储诊断",
    summary: "查看当前后端解析结果、能力矩阵以及控制面仓库健康状态。",
    icon: HardDrive,
  },
  {
    href: "/admin/supabase",
    label: "Supabase 专诊",
    summary: "当实际后端为 Supabase 时，查看更细的环境、关系与自动修复信息。",
    icon: Database,
  },
  {
    href: "/admin/settings",
    label: "站点设置",
    summary: "自定义站点名称、首页主视觉文案、footer 与后台品牌标题。",
    icon: Settings2,
  },
] as const;

export default async function AdminOverviewPage() {
  await requireAdminSession();
  const {overview} = await loadAdminManagementData();

  return (
    <div className="space-y-6">
      <AdminPageIntro
        eyebrow="Admin / Overview"
        title="后台管理控制台"
        description="这里不是另起一套后台风格，而是沿用主站的圆角、玻璃感和科技标记语言，把运行配置、模板、分组和公告放进一个统一维护面板。"
        actions={<AdminActionLink href="/admin/storage">进入诊断工具</AdminActionLink>}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AdminStatCard
          label="检测配置"
          value={overview.configCount}
          helper={`已启用 ${overview.enabledConfigCount} 条，维护中 ${overview.maintenanceCount} 条`}
        />
        <AdminStatCard
          label="请求模板"
          value={overview.templateCount}
          helper="为配置复用请求头与元数据"
        />
        <AdminStatCard
          label="分组信息"
          value={overview.groupCount}
          helper="用于首页/分组页展示站点链接与标签"
        />
        <AdminStatCard
          label="活跃通知"
          value={overview.activeNotificationCount}
          helper="控制首页通知横幅的展示数量"
        />
        <AdminStatCard
          label="最近巡检"
          value={formatAdminTimestamp(overview.lastCheckedAt)}
          helper="读取当前 dashboard 聚合快照"
        />
        <AdminStatCard
          label="状态维度"
          value={overview.statusBreakdown.length}
          helper="按最新状态聚合当前 provider 运行态"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <AdminPanel
          title="最近运行状态"
          description="从现有 dashboard 数据聚合直接读取最近检查结果，方便在改配置前先判断当前运行态。"
        >
          <div className="space-y-3">
            {overview.latestStatuses.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm text-muted-foreground">
                当前还没有可展示的巡检快照。
              </div>
            ) : (
              overview.latestStatuses.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
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
          title="维护入口"
          description="把最常改的四块数据源拆到独立页面，避免在一个超长表单里混用不同表结构。"
        >
          <div className="space-y-3">
            {SECTION_LINKS.map((item) => {
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex items-start justify-between gap-3 rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 transition hover:border-border/80 hover:bg-background"
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
