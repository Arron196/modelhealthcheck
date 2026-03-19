import type {HealthStatus, OfficialHealthStatus, ProviderType} from "../types";

export const STATUS_META: Record<
  HealthStatus,
  {
    label: string;
    description: string;
    badge: "success" | "warning" | "danger" | "secondary";
    dot: string;
  }
> = {
  operational: {
    label: "正常",
    description: "请求响应如常",
    badge: "success",
    dot: "bg-emerald-500",
  },
  degraded: {
    label: "延迟",
    description: "响应成功但耗时升高",
    badge: "warning",
    dot: "bg-amber-500",
  },
  failed: {
    label: "异常",
    description: "请求失败或超时",
    badge: "danger",
    dot: "bg-rose-500",
  },
  validation_failed: {
    label: "验证失败",
    description: "请求成功但回答未通过验证",
    badge: "warning",
    dot: "bg-orange-500",
  },
  maintenance: {
    label: "维护中",
    description: "人工维护,已停止检查",
    badge: "secondary",
    dot: "bg-blue-500",
  },
  error: {
    label: "错误",
    description: "请求异常（网络错误、API报错、连接失败）",
    badge: "danger",
    dot: "bg-red-600",
  },
  pending: {
    label: "待检查",
    description: "配置已启用，等待首次检查结果",
    badge: "secondary",
    dot: "bg-slate-400",
  },
};

export const OFFICIAL_STATUS_META: Record<
  OfficialHealthStatus,
  {
    label: string;
    description: string;
    color: string; // Tailwind 文本颜色类
  }
> = {
  operational: {
    label: "正常",
    description: "官方服务正常运行",
    color: "text-emerald-600",
  },
  degraded: {
    label: "降级",
    description: "官方服务性能降级",
    color: "text-amber-600",
  },
  down: {
    label: "故障",
    description: "官方服务出现故障",
    color: "text-rose-600",
  },
  unknown: {
    label: "未知",
    description: "无法获取官方状态",
    color: "text-gray-500",
  },
};

export const PROVIDER_LABEL: Record<ProviderType, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
};
