import Link from "next/link";
import {Database, ShieldAlert, Siren, Sparkles} from "lucide-react";

import {AdminPageIntro, AdminPanel, AdminStatCard, AdminStatusBanner} from "@/components/admin/admin-primitives";
import {buttonVariants} from "@/components/ui/button";
import {runSupabaseAutoFixAction, runSupabaseAutoMigrateAction} from "@/app/admin/actions";
import {requireAdminSession} from "@/lib/admin/auth";
import {runSupabaseDiagnostics, type SupabaseDiagnosticCheck} from "@/lib/admin/supabase-diagnostics";
import type {RuntimeMigrationCheck} from "@/lib/supabase/runtime-migrations";
import {formatAdminTimestamp, getAdminFeedback} from "@/lib/admin/view";
import {cn} from "@/lib/utils";

export const dynamic = "force-dynamic";

function getDiagnosticToneClass(status: SupabaseDiagnosticCheck["status"]): string {
  switch (status) {
    case "pass":
      return "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300";
    case "warn":
      return "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300";
    default:
      return "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300";
  }
}

function renderCheckCard(check: SupabaseDiagnosticCheck) {
  return (
    <div
      key={check.id}
      className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">{check.label}</div>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ring-1",
                getDiagnosticToneClass(check.status)
              )}
            >
              {check.status}
            </span>
            <span className="rounded-full border border-border/40 bg-background/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {check.scope}
            </span>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{check.detail}</p>
          {check.hint ? (
            <p className="text-xs leading-5 text-muted-foreground/90">建议：{check.hint}</p>
          ) : null}
        </div>

        {typeof check.durationMs === "number" ? (
          <div className="text-xs text-muted-foreground">{check.durationMs} ms</div>
        ) : null}
      </div>
    </div>
  );
}

interface AdminSupabaseDiagnosticsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function renderRepairCard(check: {
  id: string;
  label: string;
  status: "healthy" | "repairable" | "blocked";
  detail: string;
  hint?: string;
  affectedCount: number;
}) {
  const toneClass =
    check.status === "healthy"
      ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300"
      : check.status === "repairable"
        ? "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300"
        : "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300";

  return (
    <div
      key={check.id}
      className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">{check.label}</div>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ring-1",
                toneClass
              )}
            >
              {check.status}
            </span>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{check.detail}</p>
          {check.hint ? (
            <p className="text-xs leading-5 text-muted-foreground/90">建议：{check.hint}</p>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">{check.affectedCount} 项</div>
      </div>
    </div>
  );
}

function renderMigrationCard(check: RuntimeMigrationCheck) {
  const toneClass =
    check.status === "healthy"
      ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300"
      : check.status === "pending"
        ? "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300"
        : "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300";

  return (
    <div
      key={check.id}
      className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">{check.label}</div>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ring-1",
                toneClass
              )}
            >
              {check.status}
            </span>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{check.detail}</p>
          {check.hint ? (
            <p className="text-xs leading-5 text-muted-foreground/90">建议：{check.hint}</p>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">{check.fileName}</div>
      </div>
    </div>
  );
}

export default async function AdminSupabaseDiagnosticsPage({
  searchParams,
}: AdminSupabaseDiagnosticsPageProps) {
  await requireAdminSession();
  const [diagnostics, params] = await Promise.all([runSupabaseDiagnostics(), searchParams]);
  const feedback = getAdminFeedback(params);

  return (
    <div className="space-y-6">
      <AdminPageIntro
        eyebrow="Admin / Supabase"
        title="Supabase 自动诊断"
        description="这不是简单的在线探针，而是按当前仓库的真实依赖去检查环境变量、客户端初始化、公开链路和后台关键对象是否可读，让你能快速判断问题到底出在配置、网络、权限还是 schema。"
        actions={
          <Link
            href="/admin/supabase"
            className={cn(buttonVariants({variant: "outline", size: "lg"}), "rounded-full px-5")}
          >
            重新运行诊断
          </Link>
        }
      />

      {feedback ? <AdminStatusBanner type={feedback.type} message={feedback.message} /> : null}

      {diagnostics.failCount > 0 ? (
        <AdminStatusBanner
          type="error"
          message={`本次诊断发现 ${diagnostics.failCount} 项失败，${diagnostics.warnCount} 项警告。优先处理失败项。`}
        />
      ) : (
        <AdminStatusBanner
          type="success"
          message={`本次诊断未发现失败项${diagnostics.warnCount > 0 ? `，但仍有 ${diagnostics.warnCount} 项警告` : "，整体链路正常"}。`}
        />
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard label="项目 Host" value={diagnostics.projectHost ?? "未解析"} helper="对 SUPABASE_URL 的安全摘要" />
        <AdminStatCard label="Schema" value={diagnostics.schema} helper="public/admin 客户端统一使用此 schema" />
        <AdminStatCard label="失败项" value={diagnostics.failCount} helper={`通过 ${diagnostics.passCount} 项，警告 ${diagnostics.warnCount} 项`} />
        <AdminStatCard label="可修复项" value={diagnostics.repairableCount} helper="只统计当前应用内可以安全自动修复的问题" />
        <AdminStatCard label="自动迁移" value={diagnostics.autoMigrationEnabled ? "已启用" : "未启用"} helper={diagnostics.autoMigrationEnabled ? `连接来源：${diagnostics.autoMigrationConnectionSource}` : "需配置直连数据库 URL"} />
        <AdminStatCard label="诊断时间" value={formatAdminTimestamp(diagnostics.generatedAt)} helper="页面每次打开都会重新执行 server-side 检查" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <AdminPanel
          title="环境与客户端"
          description="先确认 URL / key / schema 是否合理，再确认 public 与 admin 两条客户端链路能否在服务端成功初始化。"
          trailing={<Sparkles className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="space-y-3">
            {[...diagnostics.environmentChecks, ...diagnostics.clientChecks].map(renderCheckCard)}
          </div>
        </AdminPanel>

        <AdminPanel
          title="读数摘要"
          description="这里把最值得先看的信号压缩成一句话，便于快速定位。"
          trailing={<Siren className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="space-y-3 text-sm leading-7 text-muted-foreground">
            <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm">
              {diagnostics.ok
                ? "当前没有失败项，说明 Supabase 至少满足本仓库关键路径的基本读取要求。"
                : "存在明确失败项，说明当前项目并非只是“慢”，而是在配置、网络、权限或 schema 某一层已经断开。"}
            </div>
            <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm">
              public 检查主要回答“公开链路能否读取应该公开的对象”；admin 检查则回答“后台管理和轮询是否具备足够读权限”。
            </div>
            <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm">
              如果 public 为警告而 admin 正常，通常意味着 RLS / 公开权限边界需要调整；如果两边都失败，更可能是 URL、key、schema 或网络链路本身有问题。
            </div>
          </div>
        </AdminPanel>
      </div>

      <AdminPanel
        title="关键对象检查"
        description="诊断页不会做重量级 introspection，而是对当前仓库实际依赖的表/视图执行最小读取。这样结果更接近真实运行态。"
        trailing={<Database className="h-4 w-4 text-muted-foreground" />}
      >
        <div className="space-y-3">{diagnostics.relationChecks.map(renderCheckCard)}</div>
      </AdminPanel>

      <AdminPanel
        title="自动迁移结构"
        description="当缺失的是应用自有表结构时，项目可以在配置了直连数据库连接串后自动执行受限 migration 文件；不会尝试运行任意 SQL。"
        trailing={
          <form action={runSupabaseAutoMigrateAction}>
            <button
              type="submit"
              className={cn(buttonVariants({size: "lg"}), "rounded-full px-5")}
            >
              执行自动迁移
            </button>
          </form>
        }
      >
        <div className="space-y-3">{diagnostics.migrationChecks.map(renderMigrationCard)}</div>
      </AdminPanel>

      <AdminPanel
        title="自动修复数据库"
        description="这里只处理应用内能够安全自动修复的数据一致性问题，不会假装替你修复环境变量、网络、RLS 或缺失 migration。"
        trailing={
          <form action={runSupabaseAutoFixAction}>
            <button
              type="submit"
              className={cn(buttonVariants({size: "lg"}), "rounded-full px-5")}
            >
              执行自动修复
            </button>
          </form>
        }
      >
        <div className="space-y-3">{diagnostics.repairChecks.map(renderRepairCard)}</div>
      </AdminPanel>

      <AdminPanel
        title="排障建议"
        description="当你看到失败时，优先按错误类型倒推，而不是盲目改一堆环境变量。"
        trailing={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 text-sm leading-7 text-muted-foreground shadow-sm">
            <span className="font-medium text-foreground">配置错误</span>
            <br />
            先核对 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_OR_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_DB_SCHEMA` 是否与当前项目一致。
          </div>
          <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 text-sm leading-7 text-muted-foreground shadow-sm">
            <span className="font-medium text-foreground">连接错误</span>
            <br />
            若提示 timeout / connect / DNS，更像是网络层、出站策略或 Supabase 可达性问题，而不是单纯的表缺失。
          </div>
          <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 text-sm leading-7 text-muted-foreground shadow-sm">
            <span className="font-medium text-foreground">权限错误</span>
            <br />
            public 范围的 warning 常见于 RLS；admin 范围的 fail 更值得优先排查 key 类型和 service-role 可用性。
          </div>
          <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 text-sm leading-7 text-muted-foreground shadow-sm">
            <span className="font-medium text-foreground">Schema / 迁移错误</span>
            <br />
            若提示 relation / column / invalid schema，优先确认最新 migration 是否已执行，以及 `SUPABASE_DB_SCHEMA` 是否指向正确 schema。
          </div>
        </div>
      </AdminPanel>
    </div>
  );
}
