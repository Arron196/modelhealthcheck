import {runSupabaseAutoFixAction, runSupabaseAutoMigrateAction} from "@/app/admin/actions";
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
        title="存储后端诊断"
        description="这个页面负责说明当前项目到底跑在 Supabase、本地 Postgres 还是 SQLite 上，并把控制面读写能力、后端能力矩阵以及 Supabase 专属控制操作统一收口到一个地方。"
      />

      {feedback ? <AdminStatusBanner type={feedback.type} message={feedback.message} /> : null}

      <StorageDiagnosticsClient
        initialSnapshot={initialSnapshot}
        refreshAfterMount={Boolean(feedback)}
        runAutoFixAction={runSupabaseAutoFixAction}
        runAutoMigrateAction={runSupabaseAutoMigrateAction}
      />
    </div>
  );
}
