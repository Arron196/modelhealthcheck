import "server-only";

import type {CheckConfigRow, CheckRequestTemplateRow, GroupInfoRow, SystemNotificationRow} from "@/lib/types/database";
import {loadDashboardData} from "@/lib/core/dashboard-data";
import {getControlPlaneStorage, getStorageCapabilities} from "@/lib/storage/resolver";
import {logError} from "@/lib/utils";

export const ADMIN_PROVIDER_TYPES = ["openai", "anthropic", "gemini"] as const;
export type AdminProviderType = (typeof ADMIN_PROVIDER_TYPES)[number];

export const ADMIN_NOTIFICATION_LEVELS = ["info", "warning", "error"] as const;
export type AdminNotificationLevel = (typeof ADMIN_NOTIFICATION_LEVELS)[number];

export interface AdminCheckConfigRow extends CheckConfigRow {
  updated_at?: string | null;
}

export interface AdminOverviewData {
  configCount: number;
  enabledConfigCount: number;
  maintenanceCount: number;
  templateCount: number;
  groupCount: number;
  activeNotificationCount: number;
  lastCheckedAt: string | null;
  latestStatuses: Array<{
    id: string;
    name: string;
    status: string;
    checkedAt: string;
    groupName: string | null;
  }>;
  statusBreakdown: Array<{
    status: string;
    count: number;
  }>;
}

export interface AdminManagementData {
  configs: AdminCheckConfigRow[];
  templates: CheckRequestTemplateRow[];
  groups: GroupInfoRow[];
  notifications: SystemNotificationRow[];
  groupNames: string[];
  overview: AdminOverviewData;
}

async function loadConfigs(): Promise<AdminCheckConfigRow[]> {
  const storage = await getControlPlaneStorage();
  return storage.checkConfigs.list();
}

async function loadTemplates(): Promise<CheckRequestTemplateRow[]> {
  const storage = await getControlPlaneStorage();
  return storage.requestTemplates.list();
}

async function loadGroups(): Promise<GroupInfoRow[]> {
  const storage = await getControlPlaneStorage();
  return storage.groups.list();
}

async function loadNotifications(): Promise<SystemNotificationRow[]> {
  const storage = await getControlPlaneStorage();
  return storage.notifications.list();
}

function buildOverview(input: {
  configs: AdminCheckConfigRow[];
  templates: CheckRequestTemplateRow[];
  groups: GroupInfoRow[];
  notifications: SystemNotificationRow[];
  lastCheckedAt: string | null;
  latestStatuses: Array<{
    id: string;
    name: string;
    status: string;
    checkedAt: string;
    groupName: string | null;
  }>;
}): AdminOverviewData {
  const statusMap = new Map<string, number>();

  for (const item of input.latestStatuses) {
    statusMap.set(item.status, (statusMap.get(item.status) ?? 0) + 1);
  }

  return {
    configCount: input.configs.length,
    enabledConfigCount: input.configs.filter((item) => item.enabled).length,
    maintenanceCount: input.configs.filter((item) => item.is_maintenance).length,
    templateCount: input.templates.length,
    groupCount: input.groups.length,
    activeNotificationCount: input.notifications.filter((item) => item.is_active).length,
    lastCheckedAt: input.lastCheckedAt,
    latestStatuses: input.latestStatuses,
    statusBreakdown: [...statusMap.entries()]
      .map(([status, count]) => ({status, count}))
      .sort((left, right) => right.count - left.count),
  };
}

export async function loadAdminManagementData(): Promise<AdminManagementData> {
  const capabilities = getStorageCapabilities();
  const [configs, templates, groups, notifications] = await Promise.all([
    loadConfigs(),
    loadTemplates(),
    loadGroups(),
    loadNotifications(),
  ]);
  let dashboard: Awaited<ReturnType<typeof loadDashboardData>> | null = null;

  if (capabilities.historySnapshots || capabilities.availabilityStats) {
    try {
      dashboard = await loadDashboardData({refreshMode: "never", trendPeriod: "7d"});
    } catch (error) {
      logError("load admin overview dashboard failed", error);
    }
  }

  const groupNames = Array.from(
    new Set(
      [...groups.map((item) => item.group_name), ...configs.map((item) => item.group_name ?? "")]
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right, "zh-CN"));

  const latestStatuses = (dashboard?.providerTimelines ?? [])
    .slice()
    .sort(
      (left, right) =>
        new Date(right.latest.checkedAt).getTime() - new Date(left.latest.checkedAt).getTime()
    )
    .slice(0, 8)
    .map((item) => ({
      id: item.id,
      name: item.latest.name,
      status: item.latest.status,
      checkedAt: item.latest.checkedAt,
      groupName: item.latest.groupName ?? null,
    }));

  return {
    configs,
    templates,
    groups,
    notifications,
    groupNames,
    overview: buildOverview({
      configs,
      templates,
      groups,
      notifications,
      lastCheckedAt: dashboard?.lastUpdated ?? null,
      latestStatuses,
    }),
  };
}
