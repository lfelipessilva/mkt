import React, { useState } from "react";
import type { TikTokPerformanceItem } from "../types";
import { BarChart3, Eye, Heart } from "lucide-react";
import { Card, Tabs } from "../ui";

export interface ChartItemData {
  id: string;
  label: string;
  value: number;
  percentage: number;
  accountId: string;
  metricLabel: string;
}

export function computeTopPerformanceItems(
  items: TikTokPerformanceItem[],
  maxCount = 6,
  metric: "views" | "likes" = "views"
): ChartItemData[] {
  if (!items || items.length === 0) return [];

  const sorted = [...items].sort((a, b) => {
    const valA = Number(a[metric]) || 0;
    const valB = Number(b[metric]) || 0;
    return valB - valA;
  });

  const sliced = sorted.slice(0, maxCount);
  const maxValue = Math.max(...sliced.map((i) => Number(i[metric]) || 0), 1);

  return sliced.map((item) => {
    const value = Number(item[metric]) || 0;
    const percentage = Math.round((value / maxValue) * 100);
    const label = item.tema || item.archetype_title || `@${item.account_id}`;
    return {
      id: item.id || item.tiktok_post_id || item.run_id,
      label,
      value,
      percentage,
      accountId: item.account_id,
      metricLabel: metric === "views" ? "views" : "curtidas",
    };
  });
}

export interface PerformanceChartProps {
  items: TikTokPerformanceItem[];
}

export function PerformanceChart({
  items,
}: PerformanceChartProps): React.JSX.Element {
  const [metric, setMetric] = useState<"views" | "likes">("views");
  const chartData = computeTopPerformanceItems(items, 6, metric);

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <BarChart3 className="h-4 w-4" />
          </span>
          <h3 className="text-base font-semibold tracking-tight text-slate-900">
            Top Carrosséis por Engajamento
          </h3>
        </div>

        <Tabs
          ariaLabel="Métrica do gráfico"
          value={metric}
          onChange={(id) => setMetric(id as "views" | "likes")}
          items={[
            {
              id: "views",
              label: (
                <>
                  <Eye className="h-3.5 w-3.5" />
                  Visualizações
                </>
              ),
            },
            {
              id: "likes",
              label: (
                <>
                  <Heart className="h-3.5 w-3.5" />
                  Curtidas
                </>
              ),
            },
          ]}
        />
      </div>

      {chartData.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">
          Sem dados suficientes para gerar o gráfico de desempenho.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {chartData.map((item) => (
            <div key={item.id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-medium text-slate-700">
                  <span className="mr-1.5 text-slate-400">
                    @{item.accountId}
                  </span>
                  {item.label}
                </span>
                <span className="ml-2 flex-none font-semibold text-slate-800">
                  {item.value.toLocaleString("pt-BR")}{" "}
                  <span className="font-normal text-slate-400">
                    {item.metricLabel}
                  </span>
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={
                    metric === "views"
                      ? "h-full rounded-full bg-blue-600 transition-all duration-500"
                      : "h-full rounded-full bg-rose-500 transition-all duration-500"
                  }
                  style={{ width: `${item.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
