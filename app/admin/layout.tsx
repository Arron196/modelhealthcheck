import type {ReactNode} from "react";

import {AdminShell} from "@/components/admin/admin-shell";
import {getAdminSession} from "@/lib/admin/auth";
import {loadSiteSettings} from "@/lib/site-settings";

export const dynamic = "force-dynamic";

export default async function AdminLayout({children}: {children: ReactNode}) {
  const [session, siteSettings] = await Promise.all([getAdminSession(), loadSiteSettings()]);
  return (
    <AdminShell
      username={session?.username}
      siteName={siteSettings.siteName}
      consoleTitle={siteSettings.adminConsoleTitle}
    >
      {children}
    </AdminShell>
  );
}
