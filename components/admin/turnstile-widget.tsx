import Script from "next/script";

import {AdminField} from "@/components/admin/admin-primitives";

interface TurnstileWidgetProps {
  action: string;
  siteKey: string | null;
}

export function TurnstileWidget({action, siteKey}: TurnstileWidgetProps) {
  if (!siteKey) {
    return null;
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        async
        defer
        strategy="afterInteractive"
      />
      <AdminField
        label="安全校验"
        description="提交前需要完成 Cloudflare Turnstile 校验。"
      >
        <div className="rounded-[1.5rem] border border-border/40 bg-background/70 px-4 py-4 shadow-sm">
          <div className="cf-turnstile" data-sitekey={siteKey} data-action={action} />
        </div>
      </AdminField>
    </>
  );
}
