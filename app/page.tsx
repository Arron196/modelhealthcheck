import Link from "next/link";

import {DashboardBootstrap} from "@/components/dashboard-bootstrap";
import {ClientYear} from "@/components/client-time";
import {getAdminSession} from "@/lib/admin/auth";
import packageJson from "@/package.json";
import {loadSiteSettings} from "@/lib/site-settings";

const ESTIMATED_VERSION = `v${packageJson.version}`;
const FALLBACK_YEAR = String(new Date().getFullYear());

export default async function Home() {
  const [siteSettings, adminSession] = await Promise.all([
    loadSiteSettings(),
    getAdminSession(),
  ]);

  return (
    <div className="py-8 md:py-16">
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 sm:gap-8 sm:px-6 lg:px-12">
        <DashboardBootstrap
          siteSettings={siteSettings}
          canForceRefresh={Boolean(adminSession)}
        />
      </main>
      
      <footer className="mt-16 border-t border-border/40">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col items-center justify-between gap-4 px-3 py-6 sm:flex-row sm:px-6 lg:px-12">
          <div className="text-sm text-muted-foreground">
            © <ClientYear placeholder={FALLBACK_YEAR} /> {siteSettings.footerBrand}. 保留所有权利。
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/60 px-3 py-1 text-xs text-muted-foreground shadow-sm transition hover:border-border/80 hover:text-foreground"
            >
              <span className="font-medium opacity-70">进入</span>
              <span>后台</span>
            </Link>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/60 px-3 py-1 text-xs text-muted-foreground shadow-sm transition hover:border-border/80 hover:text-foreground">
              <span className="font-medium opacity-70">版本</span>
              <span className="font-mono">{ESTIMATED_VERSION}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
