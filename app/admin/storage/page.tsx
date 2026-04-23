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
        title="存储"
        description="查看后端状态，处理连接、导入和切换。"
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
