"use client";

import {useCallback, useEffect, useState} from "react";

import {GroupDashboardView} from "@/components/group-dashboard-view";
import {GroupDashboardSkeleton} from "@/components/dashboard-skeleton";
import {fetchGroupWithCache} from "@/lib/core/group-frontend-cache";
import type {GroupDashboardData} from "@/lib/core/group-data";
import type {AvailabilityPeriod} from "@/lib/types";

const DEFAULT_PERIOD: AvailabilityPeriod = "7d";

interface GroupDashboardBootstrapProps {
  groupName: string;
  canForceRefresh: boolean;
}

export function GroupDashboardBootstrap({
  groupName,
  canForceRefresh,
}: GroupDashboardBootstrapProps) {
  const [data, setData] = useState<GroupDashboardData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = useCallback(
    async (forceFresh?: boolean) => {
      try {
        const result = await fetchGroupWithCache({
          groupName,
          trendPeriod: DEFAULT_PERIOD,
          forceFresh,
          revalidateIfFresh: true,
          onBackgroundUpdate: (nextData) => {
            setData(nextData);
          },
        });
        setErrorMessage(null);
        setData(result.data);
      } catch (error) {
        console.error("[check-cx] 分组首屏加载失败", error);
        setErrorMessage("数据加载失败，请稍后重试");
      }
    },
    [groupName]
  );

  useEffect(() => {
    let isActive = true;
    const run = async () => {
      try {
        const result = await fetchGroupWithCache({
          groupName,
          trendPeriod: DEFAULT_PERIOD,
          revalidateIfFresh: true,
          onBackgroundUpdate: (nextData) => {
            if (isActive) {
              setData(nextData);
            }
          },
        });
        if (!isActive) {
          return;
        }
        setErrorMessage(null);
        setData(result.data);
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error("[check-cx] 分组首屏加载失败", error);
        setErrorMessage("数据加载失败，请稍后重试");
      }
    };
    run().catch(() => undefined);
    return () => {
      isActive = false;
    };
  }, [groupName]);

  if (!data) {
    return (
      <div>
        <GroupDashboardSkeleton />
        {errorMessage && (
          <div className="mt-6 flex justify-center">
            <div className="inline-flex items-center gap-3 rounded-full border border-border/60 bg-background/60 px-4 py-2 text-sm text-muted-foreground">
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => loadData()}
                className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background transition-colors hover:bg-foreground/90"
              >
                重新加载
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <GroupDashboardView
      groupName={groupName}
      initialData={data}
      canForceRefresh={canForceRefresh}
    />
  );
}
