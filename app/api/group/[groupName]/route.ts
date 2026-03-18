import {NextResponse} from "next/server";
import {getAdminSession} from "@/lib/admin/auth";
import {loadGroupDashboardData} from "@/lib/core/group-data";
import {getPollingIntervalMs} from "@/lib/core/polling-config";
import type {AvailabilityPeriod} from "@/lib/types";

interface RouteContext {
  params: Promise<{ groupName: string }>;
}

export const revalidate = 0;
export const dynamic = "force-dynamic";

/** 数据变化周期：5 分钟 */
const DATA_CHANGE_CYCLE_SECONDS = 5 * 60;

/**
 * 生成简单的哈希作为 ETag
 * 使用 djb2 算法，足够快且碰撞率低
 */
function generateETag(data: string): string {
  let hash = 5381;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) + hash) ^ data.charCodeAt(i);
  }
  // 转为无符号 32 位整数的十六进制
  return `"${(hash >>> 0).toString(16)}"`;
}

export async function GET(_request: Request, context: RouteContext) {
  const { groupName } = await context.params;
  const decodedGroupName = decodeURIComponent(groupName);

  const { searchParams } = new URL(_request.url);
  const period = searchParams.get("trendPeriod");
  const forceRefreshParam = searchParams.get("forceRefresh");
  const bypassCacheParam = searchParams.get("bypassCache");
  const forceRefreshRequested =
    forceRefreshParam === "1" || forceRefreshParam === "true";
  const adminSession = forceRefreshRequested ? await getAdminSession() : null;
  const shouldForceRefresh = forceRefreshRequested && Boolean(adminSession);
  const shouldBypassCache =
    bypassCacheParam === "1" || bypassCacheParam === "true";
  const trendPeriod = (["7d", "15d", "30d"] as AvailabilityPeriod[]).includes(
    period as AvailabilityPeriod
  )
    ? (period as AvailabilityPeriod)
    : undefined;

  const data = await loadGroupDashboardData(decodedGroupName, {
    refreshMode: shouldForceRefresh ? "always" : "never",
    trendPeriod,
    bypassCache: shouldBypassCache,
  });

  if (!data) {
    return NextResponse.json(
      { error: "分组不存在或没有配置" },
      { status: 404 }
    );
  }

  // 生成 ETag（基于数据内容）
  const { generatedAt, ...etagPayload } = data;
  void generatedAt;
  const jsonBody = JSON.stringify(etagPayload);
  const etag = generateETag(jsonBody);

  // 检查条件请求
  const ifNoneMatch = _request.headers.get("If-None-Match");
  if (ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
      },
    });
  }

  // 计算缓存时间
  const pollIntervalSeconds = Math.floor(getPollingIntervalMs() / 1000);

  const response = NextResponse.json(data);

  // Cache-Control: 浏览器每次都向 CDN 验证
  response.headers.set("Cache-Control", "public, no-cache");
  // CDN-Cache-Control: Cloudflare 边缘节点缓存
  response.headers.set("CDN-Cache-Control", `max-age=${pollIntervalSeconds}`);
  // Cloudflare-CDN-Cache-Control: 支持 stale-while-revalidate
  response.headers.set(
    "Cloudflare-CDN-Cache-Control",
    `max-age=${pollIntervalSeconds}, stale-while-revalidate=${DATA_CHANGE_CYCLE_SECONDS}`
  );
  response.headers.set("ETag", etag);
  response.headers.set("Vary", "Accept-Encoding");

  return response;
}
