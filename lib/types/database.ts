/**
 * 数据库表类型定义
 * 对应 Supabase 的 check_configs 和 check_history 表
 */

/**
 * check_configs 表的行类型
 */
export interface CheckConfigRow {
  id: string;
  name: string;
  type: string;
  model: string;
  endpoint: string;
  api_key: string;
  enabled: boolean;
  is_maintenance: boolean;
  template_id?: string | null;
  request_header?: Record<string, string> | null;
  metadata?: Record<string, unknown> | null;
  group_name?: string | null;
  created_at?: string;
}

/**
 * check_request_templates 表的行类型
 */
export interface CheckRequestTemplateRow {
  id: string;
  name: string;
  type: string;
  request_header?: Record<string, string> | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * check_history 表的行类型
 */
export interface CheckHistoryRow {
  id: string;
  config_id: string;
  status: string;
  latency_ms: number | null;
  ping_latency_ms: number | null;
  checked_at: string;
  message: string | null;
}

export interface HistorySnapshotRow extends CheckHistoryRow {
  name: string;
  type: string;
  model: string;
  endpoint: string | null;
  group_name: string | null;
}

/**
 * availability_stats 视图的行类型
 */
export interface AvailabilityStats {
  config_id: string;
  period: "7d" | "15d" | "30d";
  total_checks: number;
  operational_count: number;
  availability_pct: number | null;
}

/**
 * group_info 表的行类型
 */
export interface GroupInfoRow {
  id: string;
  group_name: string;
  website_url?: string | null;
  tags?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * system_notifications 表的行类型
 */
export interface SystemNotificationRow {
  id: string;
  message: string;
  is_active: boolean;
  level: "info" | "warning" | "error";
  created_at: string;
}

export interface SiteSettingsRow {
  singleton_key: string;
  site_name: string;
  site_description: string;
  hero_badge: string;
  hero_title_primary: string;
  hero_title_secondary: string;
  hero_description: string;
  footer_brand: string;
  admin_console_title: string;
  admin_console_description: string;
  created_at?: string;
  updated_at?: string;
}
