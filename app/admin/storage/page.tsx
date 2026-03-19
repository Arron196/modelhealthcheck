import {runSupabaseAutoFixAction, runSupabaseAutoMigrateAction} from "@/app/admin/actions";
import {ManagedStoragePanel} from "@/components/admin/managed-storage-panel";
import {StorageDiagnosticsClient} from "@/components/admin/storage-diagnostics-client";
import {AdminPageIntro, AdminStatusBanner} from "@/components/admin/admin-primitives";
import {requireAdminSession} from "@/lib/admin/auth";
import {getStorageDiagnosticsSnapshot} from "@/lib/admin/storage-diagnostics-cache";
import {getAdminFeedback} from "@/lib/admin/view";

export const dynamic = "force-dynamic";

interface AdminStoragePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminStoragePage({searchParams}: AdminStoragePageProps) {
  await requireAdminSession();
  const params = await searchParams;
  const feedback = getAdminFeedback(params);
  const initialSnapshot = getStorageDiagnosticsSnapshot({
    force: Boolean(feedback),
    triggerRefresh: true,
  });

  return (
    <div className="space-y-6">
      <AdminPageIntro
        eyebrow="Admin / Storage"
        title="存储管理与诊断"
        description="这个页面负责统一管理当前项目的托管存储拓扑：包括 PostgreSQL 连接测试、控制面导入、主备启用，以及当前实际运行在 Supabase、本地 Postgres 还是 SQLite 上的诊断结果。"
      />

      {feedback ? <AdminStatusBanner type={feedback.type} message={feedback.message} /> : null}

      <ManagedStoragePanel />

      <StorageDiagnosticsClient
        initialSnapshot={initialSnapshot}
        refreshAfterMount={Boolean(feedback)}
        runAutoFixAction={runSupabaseAutoFixAction}
        runAutoMigrateAction={runSupabaseAutoMigrateAction}
      />
    </div>
  );
}
