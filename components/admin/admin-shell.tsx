"use client";

import type {ReactNode} from "react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {BellRing, Boxes, FolderTree, HardDrive, LayoutDashboard, Layers3, Settings2, ShieldCheck} from "lucide-react";

import {CornerPlus} from "@/components/admin/admin-primitives";
import {cn} from "@/lib/utils";

const NAV_ITEMS = [
  {
    href: "/admin",
    label: "总览",
    description: "运行态与入口分发",
    icon: LayoutDashboard,
  },
  {
    href: "/admin/configs",
    label: "检测配置",
    description: "Provider 配置与开关",
    icon: Boxes,
  },
  {
    href: "/admin/templates",
    label: "请求模板",
    description: "头信息与元数据模板",
    icon: Layers3,
  },
  {
    href: "/admin/groups",
    label: "分组信息",
    description: "站点链接与标签维护",
    icon: FolderTree,
  },
  {
    href: "/admin/notifications",
    label: "系统通知",
    description: "首页横幅与告警文案",
    icon: BellRing,
  },
  {
    href: "/admin/storage",
    label: "存储诊断",
    description: "后端解析、能力矩阵与控制面检查",
    icon: HardDrive,
  },
  {
    href: "/admin/settings",
    label: "站点设置",
    description: "品牌名称与全局展示文案",
    icon: Settings2,
  },
] as const;

function isActivePath(currentPath: string, href: string): boolean {
  if (href === "/admin") {
    return currentPath === href;
  }

  return currentPath.startsWith(href);
}

export function AdminShell({
  children,
  username,
  siteName,
  consoleTitle,
  consoleDescription,
}: {
  children: ReactNode;
  username?: string;
  siteName: string;
  consoleTitle: string;
  consoleDescription: string;
}) {
  const pathname = usePathname();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen py-8 md:py-16">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 sm:px-6 lg:px-12 xl:flex-row xl:items-start">
        <aside className="xl:sticky xl:top-8 xl:w-[300px] xl:self-start">
          <div className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-background/60 p-5 shadow-sm backdrop-blur-sm sm:p-6">
            <CornerPlus className="left-4 top-4" />
            <CornerPlus className="right-4 top-4" />
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground shadow-sm">
                  Internal Console
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-[-0.05em] text-foreground sm:text-3xl">
                    {consoleTitle}
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {consoleDescription}
                  </p>
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground shadow-sm">
                    <span>Site</span>
                    <span className="max-w-[150px] truncate text-foreground/80 normal-case tracking-normal">
                      {siteName}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                {NAV_ITEMS.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group rounded-[1.5rem] border px-4 py-3 transition",
                        active
                          ? "border-foreground/15 bg-foreground text-background shadow-sm"
                          : "border-border/40 bg-background/70 text-foreground hover:border-border/80 hover:bg-background"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border",
                            active
                              ? "border-white/10 bg-white/10 text-background"
                              : "border-border/40 bg-background/80 text-muted-foreground transition group-hover:text-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{item.label}</div>
                          <div
                            className={cn(
                              "mt-1 text-xs leading-5",
                              active ? "text-background/70" : "text-muted-foreground"
                            )}
                          >
                            {item.description}
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>

              <div className="rounded-[1.5rem] border border-border/40 bg-background/70 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  Server-side mutations only
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  所有写操作都经由 service-role server action 执行，避免把敏感配置写进客户端逻辑。
                </p>
              </div>

              {username ? (
                <div className="rounded-[1.5rem] border border-border/40 bg-background/70 p-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                    Active Admin
                  </div>
                  <div className="mt-2 text-sm font-medium text-foreground">{username}</div>
                  <form method="post" action="/admin/logout" className="mt-4">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/80 px-4 py-2 text-sm text-muted-foreground transition hover:border-border/80 hover:text-foreground"
                    >
                      退出登录
                    </button>
                  </form>
                </div>
              ) : null}

              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/70 px-4 py-2 text-sm text-muted-foreground transition hover:border-border/80 hover:text-foreground"
              >
                返回公开仪表盘
              </Link>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
