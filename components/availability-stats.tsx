"use client";

import type {AvailabilityPeriod, AvailabilityStat} from "@/lib/types";
import {cn} from "@/lib/utils";

interface AvailabilityStatsProps {
  stats?: AvailabilityStat[] | null;
  period: AvailabilityPeriod;
  isMaintenance?: boolean;
}

const PERIOD_LABELS: Record<AvailabilityPeriod, string> = {
  "7d": "7 天",
  "15d": "15 天",
  "30d": "30 天",
};

function getAvailabilityColorStyle(pct: number | null | undefined) {
  if (pct === null || pct === undefined) {
    return undefined;
  }
  const clamped = Math.max(0, Math.min(100, pct));
  // 0 -> red, 100 -> green
  const hue = (clamped / 100) * 120;
  return { color: `hsl(${hue} 80% 45%)` };
}

export function AvailabilityStats({ stats, period, isMaintenance }: AvailabilityStatsProps) {
  const current = stats?.find((item) => item.period === period);
  const pct = current?.availabilityPct ?? null;
  const pctLabel = pct === null ? "—" : `${pct.toFixed(2)}%`;

  // 维护模式下的特殊展示
  if (isMaintenance) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-dashed border-blue-500/30 bg-blue-500/5 px-3 py-2">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-500">
            可用性 ({PERIOD_LABELS[period]})
          </p>
          <p className="text-[10px] text-blue-500/70">
            {current
              ? `维护前 ${current.operationalCount}/${current.totalChecks} 成功`
              : "维护中 · 已暂停统计"}
          </p>
        </div>
        <span className="font-mono text-sm font-bold text-blue-500">
          {pctLabel}
        </span>
      </div>
    );
  }

  return (
    <div className="group/avail flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/40">
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors group-hover/avail:text-foreground/80">
          可用性 ({PERIOD_LABELS[period]})
        </p>
        <p className="text-[10px] text-muted-foreground/70 transition-colors group-hover/avail:text-muted-foreground">
          {current
            ? `${current.operationalCount}/${current.totalChecks} 成功`
            : "暂无数据"}
        </p>
      </div>
      <span
        className={cn(
          "font-mono text-sm font-bold truncate transition-transform duration-300 group-hover/avail:scale-105",
          pct === null ? "text-muted-foreground" : ""
        )}
        style={getAvailabilityColorStyle(pct)}
      >
        {pctLabel}
      </span>
    </div>
  );
}
