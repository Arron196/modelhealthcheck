import type {Metadata} from "next";
import "./globals.css";
import "@/lib/core/poller";
import NextTopLoader from "nextjs-toploader";
import {ThemeProvider} from "@/components/theme-provider";
import {NotificationBanner} from "@/components/notification-banner";
import {loadSiteSettings} from "@/lib/site-settings";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await loadSiteSettings();
  const iconUrl = settings.siteIconUrl || "/favicon.png";

  return {
    title: settings.siteName,
    description: settings.siteDescription,
    icons: {
      icon: [{url: iconUrl}],
      shortcut: [{url: iconUrl}],
      apple: [{url: iconUrl}],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <NextTopLoader color="var(--foreground)" showSpinner={false} />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NotificationBanner />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
