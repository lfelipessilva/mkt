import React, { useState } from "react";
import type { TikTokPerformanceItem } from "../types";
import { BarChart3, Eye, Heart } from "lucide-react";

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

export function PerformanceChart({ items }: PerformanceChartProps): React.JSX.Element {
  const [metric, setMetric] = useState<"views" | "likes">("views");
  const chartData = computeTopPerformanceItems(items, 6, metric);

  return (
    <div className="performance-chart-card bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-slate-800">
            Top Carrosséis por Engajamento
          </h3>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            className={`btn-chart-toggle px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
              metric === "views"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
            onClick={() => setMetric("views")}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Visualizações</span>
          </button>
          <button
            type="button"
            className={`btn-chart-toggle px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
              metric === "likes"
                ? "bg-white text-rose-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
            onClick={() => setMetric("likes")}
          >
            <Heart className="w-3.5 h-3.5" />
            <span>Curtidas</span>
          </button>
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="py-8 text-center text-slate-400 text-sm">
          Sem dados suficientes para gerar o gráfico de desempenho.
        </div>
      ) : (
        <div className="chart-bars-list flex flex-col gap-3">
          {chartData.map((item) => (
            <div key={item.id} className="chart-bar-item flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 truncate max-w-[260px] sm:max-w-md">
                  <span className="text-slate-400 mr-1.5">@{item.accountId}</span>
                  {item.label}
                </span>
                <span className="font-semibold text-slate-800 ml-2">
                  {item.value.toLocaleString("pt-BR")}{" "}
                  <span className="text-slate-400 font-normal">{item.metricLabel}</span>
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    metric === "views" ? "bg-blue-600" : "bg-rose-500"
                  }`}
                  style={{ width: `${item.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
