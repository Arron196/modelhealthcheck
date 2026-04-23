"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Database, HardDrive, Loader2, ShieldAlert, Sparkles, Wrench} from "lucide-react";

import type {runSupabaseAutoFixAction, runSupabaseAutoMigrateAction} from "@/app/admin/actions";
import {AdminPanel, AdminStatCard, AdminStatusBanner} from "@/components/admin/admin-primitives";
import {buttonVariants} from "@/components/ui/button";
import type {StorageDiagnosticsSnapshot} from "@/lib/admin/storage-diagnostics-cache";
import type {StorageDiagnosticCheck} from "@/lib/admin/storage-diagnostics";
import type {
  SupabaseDiagnosticCheck,
  SupabaseRepairCheck,
} from "@/lib/admin/supabase-diagnostics";
import {formatAdminTimestamp} from "@/lib/admin/view";
import type {RuntimeMigrationCheck} from "@/lib/supabase/runtime-migrations";
import {cn} from "@/lib/utils";

const REQUEST_TIMEOUT_MS = 30_000;

type AutoFixAction = typeof runSupabaseAutoFixAction;
type AutoMigrateAction = typeof runSupabaseAutoMigrateAction;

function getToneClass(
  status: "pass" | "warn" | "fail" | "healthy" | "repairable" | "blocked" | "pending"
) {
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

function getStatusLabel(
  status: "pass" | "warn" | "fail" | "healthy" | "repairable" | "blocked" | "pending"
) {
  switch (status) {
    case "pass":
    case "healthy":
      return "通过";
    case "warn":
      return "警告";
    case "fail":
      return "失败";
    case "repairable":
      return "可修复";
    case "blocked":
      return "阻断";
    case "pending":
      return "待定";
  }
}

function renderStorageCheckCard(check: StorageDiagnosticCheck | SupabaseDiagnosticCheck) {
  const scope = "scope" in check ? check.scope : null;

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
                getToneClass(check.status)
              )}
            >
              {getStatusLabel(check.status)}
            </span>
            {scope ? (
              <span className="rounded-full border border-border/40 bg-background/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {scope}
              </span>
            ) : null}
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

function renderCapabilityCard(item: {
  id: string;
  label: string;
  enabled: boolean;
  detail: string;
}) {
  return (
    <div
      key={item.id}
      className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium text-foreground">{item.label}</div>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ring-1",
            item.enabled ? getToneClass("pass") : getToneClass("warn")
          )}
        >
          {item.enabled ? "已启用" : "未启用"}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>
    </div>
  );
}

function renderRepairCard(check: SupabaseRepairCheck) {
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
                getToneClass(check.status)
              )}
            >
              {getStatusLabel(check.status)}
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
                getToneClass(check.status)
              )}
            >
              {getStatusLabel(check.status)}
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

async function fetchSnapshot(force = false): Promise<StorageDiagnosticsSnapshot> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const search = new URLSearchParams();
  if (force) {
    search.set("force", "1");
  }

  try {
    const response = await fetch(
      search.size > 0 ? `/admin/storage/data?${search.toString()}` : "/admin/storage/data",
      {
        cache: "no-store",
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`状态快照请求失败（${response.status}）`);
    }

    return (await response.json()) as StorageDiagnosticsSnapshot;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function StorageDiagnosticsClient(props: {
  initialSnapshot: StorageDiagnosticsSnapshot;
  refreshAfterMount: boolean;
  runAutoFixAction: AutoFixAction;
  runAutoMigrateAction: AutoMigrateAction;
}) {
  const [snapshot, setSnapshot] = useState(props.initialSnapshot);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isManualRefreshPending, setIsManualRefreshPending] = useState(false);
  const requestLockRef = useRef(false);
  const didMountRefreshRef = useRef(false);

  const loadSnapshot = useCallback(async (force = false) => {
    if (requestLockRef.current) {
      return;
    }

    requestLockRef.current = true;
    if (force) {
      setIsManualRefreshPending(true);
    }

    try {
      const nextSnapshot = await fetchSnapshot(force);
      setSnapshot(nextSnapshot);
      setRequestError(null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "状态快照请求失败");
    } finally {
      requestLockRef.current = false;
      if (force) {
        setIsManualRefreshPending(false);
      }
    }
  }, []);

  useEffect(() => {
    if (didMountRefreshRef.current) {
      return;
    }

    didMountRefreshRef.current = true;
    void loadSnapshot(props.refreshAfterMount || !props.initialSnapshot.report);
  }, [loadSnapshot, props.initialSnapshot.report, props.refreshAfterMount]);

  useEffect(() => {
    const intervalMs = !snapshot.report || snapshot.refreshing || snapshot.stale
      ? snapshot.pendingPollIntervalMs
      : snapshot.pollIntervalMs;
    const timer = window.setTimeout(() => {
      void loadSnapshot(false);
    }, intervalMs);

    return () => window.clearTimeout(timer);
  }, [loadSnapshot, snapshot.pendingPollIntervalMs, snapshot.pollIntervalMs, snapshot.refreshing, snapshot.report, snapshot.stale]);

  const diagnostics = snapshot.report;
  const summary = useMemo(() => {
    if (!diagnostics) {
      return null;
    }

    return {
      enabledCapabilityCount: diagnostics.capabilityItems.filter((item) => item.enabled).length,
      repositoryFailCount: diagnostics.repositoryChecks.filter((item) => item.status === "fail").length,
      repositoryWarnCount: diagnostics.repositoryChecks.filter((item) => item.status === "warn").length,
    };
  }, [diagnostics]);

  if (!diagnostics) {
    return (
      <AdminPanel
        title="存储状态快照"
        description="打开后会自动生成一份状态快照，之后定时刷新。"
        trailing={
          <button
            type="button"
            onClick={() => void loadSnapshot(true)}
            disabled={isManualRefreshPending}
            className={cn(buttonVariants({size: "lg"}), "rounded-full px-5")}
          >
            {isManualRefreshPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            立即刷新
          </button>
        }
      >
        <div className="space-y-4">
          {requestError ? <AdminStatusBanner type="error" message={requestError} /> : null}
          <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm leading-7 text-muted-foreground">
            {snapshot.refreshing
              ? "正在生成首份状态快照。"
              : "暂无状态快照，已自动生成。"}
            {snapshot.lastStartedAt ? (
              <span>
                {" "}
                最近启动：
                <span className="font-medium text-foreground">
                  {formatAdminTimestamp(snapshot.lastStartedAt)}
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </AdminPanel>
    );
  }

  const supabaseReport = diagnostics.supabaseReport;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void loadSnapshot(true)}
          disabled={isManualRefreshPending}
          className={cn(buttonVariants({variant: "outline", size: "lg"}), "rounded-full px-5")}
        >
          {isManualRefreshPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          重新刷新
        </button>
        <span className="text-xs text-muted-foreground">
          缓存 {Math.round(snapshot.refreshIntervalMs / 1000)} 秒；页面轮询 {Math.round(snapshot.pollIntervalMs / 1000)} 秒。
        </span>
      </div>

      {requestError ? <AdminStatusBanner type="error" message={requestError} /> : null}

      {snapshot.refreshing ? (
        <AdminStatusBanner
          type="success"
          message="正在刷新状态快照，先显示上一版结果。"
        />
      ) : null}

      {!diagnostics.storageReady ? (
        <AdminStatusBanner
          type="error"
          message={`当前存储未准备好：${diagnostics.storageError ?? "请检查配置与可用性。"}`}
        />
      ) : summary && summary.repositoryFailCount > 0 ? (
        <AdminStatusBanner
          type="error"
          message={`当前管理数据有 ${summary.repositoryFailCount} 项失败，${summary.repositoryWarnCount} 项警告。`}
        />
      ) : diagnostics.isFailover ? (
        <AdminStatusBanner
          type="error"
          message={`当前处于切换模式：首选 ${diagnostics.preferredProvider}，实际运行在 ${diagnostics.provider}。`}
        />
      ) : summary ? (
        <AdminStatusBanner
          type="success"
          message={`当前后端为 ${diagnostics.provider}${summary.repositoryWarnCount > 0 ? `，另有 ${summary.repositoryWarnCount} 项警告` : ""}。`}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard label="当前后端" value={diagnostics.provider} helper={`运行来源：${diagnostics.resolutionReason}`} />
        <AdminStatCard label="首选后端" value={diagnostics.preferredProvider} helper={`首选来源：${diagnostics.preferredReason}`} />
        <AdminStatCard label="启用能力" value={`${summary?.enabledCapabilityCount ?? 0}/${diagnostics.capabilityItems.length}`} helper="当前后端启用的能力数量" />
        <AdminStatCard label="失败项" value={summary?.repositoryFailCount ?? 0} helper={diagnostics.storageReady ? `警告 ${summary?.repositoryWarnCount ?? 0} 项` : "后端未就绪时会集中到初始化检查"} />
        <AdminStatCard label="更新时间" value={formatAdminTimestamp(diagnostics.generatedAt)} helper={`缓存刷新间隔 ${Math.round(snapshot.refreshIntervalMs / 1000)} 秒`} />
        <AdminStatCard label="SQLite 文件" value={diagnostics.sqliteFilePath ?? "—"} helper="仅在 SQLite 模式下显示" />
        <AdminStatCard label="Postgres 来源" value={diagnostics.postgresConnectionSource ?? "—"} helper="切到 Postgres 时会显示来源" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <AdminPanel title="当前后端与准备情况" description="先看当前后端，再确认管理数据是否已就绪。" trailing={<HardDrive className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-3">{[...diagnostics.backendChecks, ...diagnostics.repositoryChecks].map(renderStorageCheckCard)}</div>
        </AdminPanel>

        <AdminPanel title="功能范围" description="直接展示当前后端能做什么。" trailing={<Sparkles className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-3">{diagnostics.capabilityItems.map(renderCapabilityCard)}</div>
        </AdminPanel>
      </div>

      <AdminPanel title="切换建议" description="根据当前模式给出建议。" trailing={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 text-sm leading-7 text-muted-foreground shadow-sm">
              <span className="font-medium text-foreground">Supabase</span>
              <br />
              适合保留现有历史、统计和 Supabase 检查能力。
            </div>
          <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 text-sm leading-7 text-muted-foreground shadow-sm">
              <span className="font-medium text-foreground">Postgres</span>
              <br />
            适合本地或自管环境。
          </div>
          <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 text-sm leading-7 text-muted-foreground shadow-sm">
              <span className="font-medium text-foreground">SQLite</span>
              <br />
            最适合单机回退和本地演示。
          </div>
          <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 text-sm leading-7 text-muted-foreground shadow-sm">
            <span className="font-medium text-foreground">推荐方案</span>
            <br />
            如果同时配置了 Supabase 和 Postgres，建议优先使用 Supabase。
          </div>
        </div>
      </AdminPanel>

      {supabaseReport ? (
        <>
          <AdminPanel title="Supabase 检查" description="当前后端为 Supabase，因此继续显示相关检查。" trailing={<Database className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-3">{[...supabaseReport.environmentChecks, ...supabaseReport.clientChecks, ...supabaseReport.relationChecks].map(renderStorageCheckCard)}</div>
          </AdminPanel>

          <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <AdminPanel title="自动迁移" description="仅在已配置直连数据库时显示。" trailing={<form action={props.runAutoMigrateAction}><button type="submit" className={cn(buttonVariants({size: "lg"}), "rounded-full px-5")}>执行自动迁移</button></form>}>
              <div className="space-y-3">{supabaseReport.migrationChecks.map(renderMigrationCard)}</div>
            </AdminPanel>

            <AdminPanel title="自动修复" description="只处理安全可修复的问题。" trailing={<form action={props.runAutoFixAction}><button type="submit" className={cn(buttonVariants({size: "lg"}), "rounded-full px-5")}>执行自动修复</button></form>}>
              <div className="space-y-3">{supabaseReport.repairChecks.map(renderRepairCard)}</div>
            </AdminPanel>
          </div>
        </>
      ) : diagnostics.capabilities.supabaseDiagnostics ? (
        <AdminPanel title="Supabase 检查" description="当前仍指向 Supabase，但初始化还没完成。" trailing={<Wrench className="h-4 w-4 text-muted-foreground" />}>
          <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm leading-7 text-muted-foreground">
            当前首选后端仍为 <span className="font-medium text-foreground">Supabase</span>，但尚未完成初始化。
            {diagnostics.storageError ? (
              <span>
                {" "}
                最近错误：
                <span className="font-medium text-foreground">{diagnostics.storageError}</span>
              </span>
            ) : null}
            。在补齐可用后端之前，页面会保持阻断。
          </div>
        </AdminPanel>
      ) : (
        <AdminPanel title="Supabase 检查" description="当前后端不是 Supabase，因此相关检查已隐藏。" trailing={<Wrench className="h-4 w-4 text-muted-foreground" />}>
          <div className="rounded-[1.5rem] border border-dashed border-border/50 px-4 py-6 text-sm text-muted-foreground">
            当前后端为 <span className="font-medium text-foreground">{diagnostics.provider}</span>。如果之后切回 Supabase，页面会自动显示相关检查。
          </div>
        </AdminPanel>
      )}
    </div>
  );
}
