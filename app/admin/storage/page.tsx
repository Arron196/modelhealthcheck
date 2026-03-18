import Link from "next/link";
import {Database, HardDrive, ShieldAlert, Sparkles, Wrench} from "lucide-react";

import {runSupabaseAutoFixAction, runSupabaseAutoMigrateAction} from "@/app/admin/actions";
import {AdminPageIntro, AdminPanel, AdminStatCard, AdminStatusBanner} from "@/components/admin/admin-primitives";
import {buttonVariants} from "@/components/ui/button";
import {requireAdminSession} from "@/lib/admin/auth";
import {runStorageDiagnostics, type StorageDiagnosticCheck} from "@/lib/admin/storage-diagnostics";
import {formatAdminTimestamp, getAdminFeedback} from "@/lib/admin/view";
import {cn} from "@/lib/utils";
import type {RuntimeMigrationCheck} from "@/lib/supabase/runtime-migrations";
import type {SupabaseDiagnosticCheck, SupabaseRepairCheck} from "@/lib/admin/supabase-diagnostics";

export const dynamic = "force-dynamic";

interface AdminStoragePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getToneClass(status: "pass" | "warn" | "fail" | "healthy" | "repairable" | "blocked" | "pending") {
  switch (status) {
    case "pass":
    case "healthy":
      return "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300";
    case "warn":
    case "blocked":
      return "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300";
    case "repairable":
    case "pending":
      return "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300";
    default:
      return "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300";
  }
}

function renderStorageCheckCard(check: StorageDiagnosticCheck | SupabaseDiagnosticCheck) {
  const scope = "scope" in check ? check.scope : null;

  return (
    <div key={check.id} className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">{check.label}</div>
            <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ring-1", getToneClass(check.status))}>
              {check.status}
            </span>
            {scope ? (
              <span className="rounded-full border border-border/40 bg-background/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {scope}
              </span>
            ) : null}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{check.detail}</p>
          {check.hint ? <p className="text-xs leading-5 text-muted-foreground/90">建议：{check.hint}</p> : null}
        </div>
        {typeof check.durationMs === "number" ? <div className="text-xs text-muted-foreground">{check.durationMs} ms</div> : null}
      </div>
    </div>
  );
}

function renderCapabilityCard(item: {
  id: string;
  label: string;
  enabled: boolean;
  detail: string;
}) {
  return (
    <div key={item.id} className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium text-foreground">{item.label}</div>
        <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ring-1", item.enabled ? getToneClass("pass") : getToneClass("warn"))}>
          {item.enabled ? "enabled" : "disabled"}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>
    </div>
  );
}

function renderRepairCard(check: SupabaseRepairCheck) {
  return (
    <div key={check.id} className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">{check.label}</div>
            <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ring-1", getToneClass(check.status))}>
              {check.status}
            </span>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{check.detail}</p>
          {check.hint ? <p className="text-xs leading-5 text-muted-foreground/90">建议：{check.hint}</p> : null}
        </div>
        <div className="text-xs text-muted-foreground">{check.affectedCount} 项</div>
      </div>
    </div>
  );
}

function renderMigrationCard(check: RuntimeMigrationCheck) {
  return (
    <div key={check.id} className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">{check.label}</div>
            <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ring-1", getToneClass(check.status))}>
              {check.status}
            </span>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{check.detail}</p>
          {check.hint ? <p className="text-xs leading-5 text-muted-foreground/90">建议：{check.hint}</p> : null}
        </div>
        <div className="text-xs text-muted-foreground">{check.fileName}</div>
      </div>
    </div>
  );
}

export default async function AdminStoragePage({searchParams}: AdminStoragePageProps) {
  await requireAdminSession();
  const [diagnostics, params] = await Promise.all([runStorageDiagnostics(), searchParams]);
  const feedback = getAdminFeedback(params);
  const supabaseReport = diagnostics.supabaseReport;
  const enabledCapabilityCount = diagnostics.capabilityItems.filter((item) => item.enabled).length;
  const repositoryFailCount = diagnostics.repositoryChecks.filter((item) => item.status === "fail").length;
  const repositoryWarnCount = diagnostics.repositoryChecks.filter((item) => item.status === "warn").length;

  return (
    <div className="space-y-6">
      <AdminPageIntro
        eyebrow="Admin / Storage"
        title="存储后端诊断"
        description="这个页面负责说明当前项目到底跑在 Supabase、本地 Postgres 还是 SQLite 上，并把控制面读写能力、后端能力矩阵以及 Supabase 专属控制操作统一收口到一个地方。"
        actions={<Link href="/admin/storage" className={cn(buttonVariants({variant: "outline", size: "lg"}), "rounded-full px-5")}>重新运行诊断</Link>}
      />

      {feedback ? <AdminStatusBanner type={feedback.type} message={feedback.message} /> : null}

      {repositoryFailCount > 0 ? (
        <AdminStatusBanner type="error" message={`当前存储控制面有 ${repositoryFailCount} 项失败，${repositoryWarnCount} 项警告。优先处理仓库读取失败。`} />
      ) : (
        <AdminStatusBanner type="success" message={`当前后端解析为 ${diagnostics.provider}，控制面仓库读取正常${repositoryWarnCount > 0 ? `，另有 ${repositoryWarnCount} 项警告` : ""}。`} />
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard label="当前后端" value={diagnostics.provider} helper={`解析来源：${diagnostics.resolutionReason}`} />
        <AdminStatCard label="能力开关" value={`${enabledCapabilityCount}/${diagnostics.capabilityItems.length}`} helper="当前 provider 实际启用的能力数量" />
        <AdminStatCard label="仓库失败项" value={repositoryFailCount} helper={`警告 ${repositoryWarnCount} 项`} />
        <AdminStatCard label="诊断时间" value={formatAdminTimestamp(diagnostics.generatedAt)} helper="页面每次打开都会重新执行 server-side 检查" />
        <AdminStatCard label="SQLite 路径" value={diagnostics.sqliteFilePath ?? "—"} helper="仅在 SQLite 模式下有意义" />
        <AdminStatCard label="Postgres 来源" value={diagnostics.postgresConnectionSource ?? "—"} helper="仅在 Postgres 模式下展示实际连接串来源" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <AdminPanel title="后端解析与准备状态" description="先说明当前为什么会选中这个 backend，再确认控制面仓库是否已经就绪。" trailing={<HardDrive className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-3">{[...diagnostics.backendChecks, ...diagnostics.repositoryChecks].map(renderStorageCheckCard)}</div>
        </AdminPanel>

        <AdminPanel title="能力矩阵" description="这里不是泛泛而谈的“支持/不支持”，而是直接展示当前后端在这个项目里的功能边界。" trailing={<Sparkles className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-3">{diagnostics.capabilityItems.map(renderCapabilityCard)}</div>
        </AdminPanel>
      </div>

      <AdminPanel title="运行建议" description="根据当前后端模式，给出最实际的部署和运维建议。" trailing={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 text-sm leading-7 text-muted-foreground shadow-sm">
            <span className="font-medium text-foreground">Supabase</span>
            <br />
            适合保留现有历史快照、availability 统计、轮询租约和 Supabase 专属诊断能力；但也意味着更多平台级配置依赖。
          </div>
          <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 text-sm leading-7 text-muted-foreground shadow-sm">
            <span className="font-medium text-foreground">Postgres</span>
            <br />
            适合本地或自管环境的稳定控制面存储；当前实现会自动准备控制面表，但不会伪装成 Supabase 全功能替代。
          </div>
          <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 text-sm leading-7 text-muted-foreground shadow-sm">
            <span className="font-medium text-foreground">SQLite</span>
            <br />
            最适合单机回退和本地演示。管理员、设置和控制面 CRUD 可以工作，但不提供分布式租约与 Supabase 统计链路。
          </div>
          <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 text-sm leading-7 text-muted-foreground shadow-sm">
            <span className="font-medium text-foreground">升级路径</span>
            <br />
            如果只是想摆脱 Supabase 依赖，优先上本地/自管 Postgres；如果只是想要零配置可跑，SQLite 回退是最稳的默认兜底。
          </div>
        </div>
      </AdminPanel>

      {supabaseReport ? (
        <>
          <AdminPanel title="Supabase 专属诊断" description="当前后端仍然是 Supabase，因此继续暴露环境、客户端和关键关系检查。若切换到其他后端，这一块会自动隐藏。" trailing={<Database className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-3">{[...supabaseReport.environmentChecks, ...supabaseReport.clientChecks, ...supabaseReport.relationChecks].map(renderStorageCheckCard)}</div>
          </AdminPanel>

          <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <AdminPanel title="Supabase 自动迁移结构" description="仅当当前后端仍为 Supabase 且配置了可用的直连数据库 URL 时才有意义；不会执行任意 SQL。" trailing={<form action={runSupabaseAutoMigrateAction}><button type="submit" className={cn(buttonVariants({size: "lg"}), "rounded-full px-5")}>执行自动迁移</button></form>}>
              <div className="space-y-3">{supabaseReport.migrationChecks.map(renderMigrationCard)}</div>
            </AdminPanel>

            <AdminPanel title="Supabase 自动修复数据库" description="这里只处理当前项目内部能够安全自动修复的数据一致性问题，例如缺失分组行或失效模板引用。" trailing={<form action={runSupabaseAutoFixAction}><button type="submit" className={cn(buttonVariants({size: "lg"}), "rounded-full px-5")}>执行自动修复</button></form>}>
              <div className="space-y-3">{supabaseReport.repairChecks.map(renderRepairCard)}</div>
            </AdminPanel>
          </div>
        </>
      ) : (
        <AdminPanel title="Supabase 专属诊断" description="当前后端不是 Supabase，因此 Supabase 环境变量、PostgREST 关系检查、自动修复与自动迁移按钮都已自动隐藏。" trailing={<Wrench className="h-4 w-4 text-muted-foreground" />}>
          <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm text-muted-foreground">
            当前 provider 为 <span className="font-medium text-foreground">{diagnostics.provider}</span>。如果你之后显式设置 `DATABASE_PROVIDER=supabase` 或补齐 Supabase 环境变量，页面会自动切回 Supabase 专属诊断视图。
          </div>
        </AdminPanel>
      )}
    </div>
  );
}
