import {
  activateManagedStorageAction,
  importManagedPostgresAction,
  saveManagedStorageDraftAction,
  testManagedPostgresAction,
} from "@/app/admin/actions";
import {
  AdminField,
  AdminPanel,
  AdminSelect,
  AdminStatCard,
  AdminStatusBanner,
  AdminTextarea,
} from "@/components/admin/admin-primitives";
import {Button} from "@/components/ui/button";
import {loadManagedStorageSettings} from "@/lib/storage/bootstrap-store";

export function ManagedStoragePanel() {
  const settings = loadManagedStorageSettings();
  const activeTopology = settings.activePrimaryProvider
    ? `${settings.activePrimaryProvider} → ${settings.activeBackupProvider}`
    : "env-only";

  return (
    <AdminPanel
      title="托管后端切换"
      description="在这里维护 PostgreSQL 连接、主备角色和受控切换流程。v1 流程固定为：保存草稿 → 测试连接 → 导入控制面 → 启用。"
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <AdminStatCard
            label="当前拓扑"
            value={activeTopology}
            helper={settings.activatedAt ? `最近启用：${settings.activatedAt}` : "尚未启用托管拓扑"}
          />
          <AdminStatCard
            label="PostgreSQL 测试"
            value={settings.postgresLastTestOk ? "PASS" : "PENDING"}
            helper={settings.postgresLastTestedAt ?? "尚未执行连接测试"}
          />
          <AdminStatCard
            label="导入状态"
            value={settings.lastImportOk ? "READY" : "PENDING"}
            helper={settings.lastImportSummary?.importedAt ?? "尚未导入控制面数据"}
          />
        </div>

        {settings.postgresLastTestedAt ? (
          <AdminStatusBanner
            type={settings.postgresLastTestOk ? "success" : "error"}
            message={
              settings.postgresLastTestOk
                ? "最近一次 PostgreSQL 连接测试通过，可以继续执行导入或启用。"
                : "最近一次 PostgreSQL 连接测试未通过，请先修复失败项。"
            }
          />
        ) : null}

        <form className="space-y-4">
          <input type="hidden" name="returnTo" value="/admin/storage" />

          <div className="grid gap-4 md:grid-cols-2">
            <AdminField label="主后端角色" description="主后端负责当前控制面的实际读写。">
              <AdminSelect name="draft_primary_provider" defaultValue={settings.draftPrimaryProvider}>
                <option value="supabase">Supabase</option>
                <option value="postgres">PostgreSQL</option>
              </AdminSelect>
            </AdminField>

            <AdminField label="备用后端角色" description="备用后端只作为受控切换目标，不做双写。">
              <AdminSelect name="draft_backup_provider" defaultValue={settings.draftBackupProvider}>
                <option value="none">none</option>
                <option value="supabase">Supabase</option>
                <option value="postgres">PostgreSQL</option>
              </AdminSelect>
            </AdminField>
          </div>

          <AdminField
            label="PostgreSQL 连接串"
            description={
              settings.postgresConnectionMasked
                ? `已保存连接串：${settings.postgresConnectionMasked}。若本次不想修改，可留空以保留现值。`
                : "用于 PostgreSQL 主后端或备用后端的连接。"
            }
          >
            <AdminTextarea
              name="postgres_connection_string"
              placeholder="postgresql://user:password@host:5432/database"
              defaultValue=""
            />
          </AdminField>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" formAction={saveManagedStorageDraftAction} className="rounded-full">
              保存草稿
            </Button>
            <Button type="submit" formAction={testManagedPostgresAction} variant="outline" className="rounded-full">
              测试 PostgreSQL 连接
            </Button>
            <Button type="submit" formAction={importManagedPostgresAction} variant="outline" className="rounded-full">
              导入当前控制面到 PostgreSQL 侧
            </Button>
            <Button type="submit" formAction={activateManagedStorageAction} className="rounded-full">
              启用主备拓扑
            </Button>
          </div>
        </form>

        {settings.postgresTestReport ? (
          <div className="space-y-3 rounded-[1.5rem] border border-border/40 bg-background/60 p-4 shadow-sm">
            <div className="text-sm font-medium text-foreground">最近一次 PostgreSQL 测试结果</div>
            <div className="grid gap-4 md:grid-cols-4">
              <AdminStatCard label="目标主机" value={settings.postgresTestReport.host ?? "—"} helper={`SSL：${settings.postgresTestReport.sslMode}`} />
              <AdminStatCard label="目标数据库" value={settings.postgresTestReport.database ?? "—"} helper={settings.postgresTestReport.port ? `端口 ${settings.postgresTestReport.port}` : "未显式指定端口"} />
              <AdminStatCard label="当前用户" value={settings.postgresTestReport.currentUser ?? "—"} helper="来自服务端 current_user" />
              <AdminStatCard label="测试时间" value={settings.postgresTestReport.testedAt} helper={settings.postgresTestReport.serverVersion ?? "未返回版本信息"} />
            </div>
            <div className="space-y-2">
              {settings.postgresTestReport.checks.map((check) => (
                <div key={check.id} className="rounded-2xl border border-border/40 bg-background/70 px-4 py-3 text-sm shadow-sm">
                  <div className="font-medium text-foreground">{check.label}</div>
                  <p className="mt-1 text-muted-foreground">{check.detail}</p>
                  {check.hint ? <p className="mt-1 text-xs text-muted-foreground">建议：{check.hint}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {settings.lastImportSummary ? (
          <div className="rounded-[1.5rem] border border-border/40 bg-background/60 p-4 shadow-sm">
            <div className="text-sm font-medium text-foreground">最近一次导入摘要</div>
            <div className="mt-3 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <AdminStatCard label="Admin Users" value={settings.lastImportSummary.counts.adminUsers} helper="保留 id / hash" />
              <AdminStatCard label="Configs" value={settings.lastImportSummary.counts.checkConfigs} helper="Provider 配置" />
              <AdminStatCard label="Templates" value={settings.lastImportSummary.counts.requestTemplates} helper="请求模板" />
              <AdminStatCard label="Groups" value={settings.lastImportSummary.counts.groups} helper="分组信息" />
              <AdminStatCard label="Notifications" value={settings.lastImportSummary.counts.notifications} helper="系统通知" />
              <AdminStatCard label="Site Settings" value={settings.lastImportSummary.counts.hasSiteSettings ? "YES" : "NO"} helper={settings.lastImportSummary.importedAt} />
            </div>
          </div>
        ) : null}
      </div>
    </AdminPanel>
  );
}
