import { getControlPlaneStorage } from "@/lib/storage/resolver";
import { SystemNotificationRow } from "@/lib/types/database";

/**
 * 服务端获取所有活跃的系统通知
 */
export async function getActiveSystemNotifications(): Promise<SystemNotificationRow[]> {
  try {
    const storage = await getControlPlaneStorage();
    return storage.notifications.listActive();
  } catch (error) {
    console.error("Failed to fetch system notifications:", error);
    return [];
  }
}
