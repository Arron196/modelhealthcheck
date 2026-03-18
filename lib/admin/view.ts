export interface AdminFeedback {
  type: "success" | "error";
  message: string;
}

export type AdminSearchParams = Record<string, string | string[] | undefined>;

function getSingleParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export function getAdminFeedback(searchParams: AdminSearchParams): AdminFeedback | null {
  const message = getSingleParam(searchParams.notice);
  if (!message) {
    return null;
  }

  const type = getSingleParam(searchParams.noticeType) === "error" ? "error" : "success";
  return {type, message};
}

export function formatJson(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  return JSON.stringify(value, null, 2);
}

export function formatAdminTimestamp(value?: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function getStatusToneClass(status: string): string {
  switch (status) {
    case "operational":
      return "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300";
    case "degraded":
      return "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300";
    case "failed":
    case "error":
      return "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300";
    case "validation_failed":
      return "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300";
    case "maintenance":
      return "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300";
    case "info":
      return "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300";
    case "warning":
      return "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300";
    default:
      return "bg-muted text-foreground ring-border";
  }
}
