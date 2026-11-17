import React, { useState } from "react";
import type { TikTokPerformanceItem } from "../types";
import {
  BarChart3,
  Bookmark,
  Eye,
  Heart,
  MessageSquare,
  Repeat2,
} from "lucide-react";
import { Card, Tabs, cn } from "../ui";
import { AuthImage } from "./AuthImage";

export type ChartMetric = "views" | "likes" | "comments" | "saves" | "shares";

export interface ChartItemData {
  id: string;
  label: string;
  value: number;
  percentage: number;
  accountId: string;
  metricLabel: string;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  coverStoragePath?: string | null;
  slidesCount: number;
  caption?: string | null;
  publishedAt?: string | null;
  videoUrl?: string | null;
}

const METRIC_LABELS: Record<ChartMetric, string> = {
  views: "visualizações",
  likes: "curtidas",
  comments: "comentários",
  saves: "salvos",
  shares: "compartilhamentos",
};

export function resolvePerformanceCover(item: TikTokPerformanceItem): string | null {
  const slides = item.run?.slides;
  if (!slides || slides.length === 0) return null;
  const cover = slides.find((slide) => slide.position === 1) ?? slides[0];
  return cover?.storage_path ?? null;
}

export function computeTopPerformanceItems(
  items: TikTokPerformanceItem[],
  maxCount = 6,
  metric: ChartMetric = "views"
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
      metricLabel: METRIC_LABELS[metric],
      views: Number(item.views) || 0,
      likes: Number(item.likes) || 0,
      comments: Number(item.comments) || 0,
      saves: Number(item.saves) || 0,
      shares: Number(item.shares) || 0,
      coverStoragePath: resolvePerformanceCover(item),
      slidesCount: item.run?.slides?.length ?? 0,
      caption: item.legenda ?? null,
      publishedAt: item.published_at ?? null,
      videoUrl: item.video_url ?? null,
    };
  });
}

function formatCompact(value: number): string {
  return Number(value).toLocaleString("pt-BR");
}

function Chip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200"
      title={label}
    >
      {icon}
      {formatCompact(value)}
    </span>
  );
}

function RankThumb({
  storagePath,
  slidesCount,
  label,
}: {
  storagePath?: string | null;
  slidesCount: number;
  label: string;
}): React.JSX.Element {
  return (
    <div className="relative h-14 w-11 flex-none overflow-hidden rounded-md border border-slate-200 bg-slate-100">
      {storagePath ? (
        <AuthImage
          storagePath={storagePath}
          alt={label}
          className="h-full w-full object-cover"
          fallbackText=""
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[9px] text-slate-400">
          Sem capa
        </div>
      )}
      {slidesCount > 0 && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-slate-900/80 px-1 text-[9px] font-semibold text-white">
          {slidesCount}
        </span>
      )}
    </div>
  );
}

const METRIC_TABS: Array<{
  id: ChartMetric;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "views", label: "Views", icon: <Eye className="h-3.5 w-3.5" /> },
  { id: "likes", label: "Curtidas", icon: <Heart className="h-3.5 w-3.5" /> },
  {
    id: "comments",
    label: "Comentários",
    icon: <MessageSquare className="h-3.5 w-3.5" />,
  },
  { id: "saves", label: "Salvos", icon: <Bookmark className="h-3.5 w-3.5" /> },
  {
    id: "shares",
    label: "Shares",
    icon: <Repeat2 className="h-3.5 w-3.5" />,
  },
];

const BAR_TONES: Record<ChartMetric, string> = {
  views: "bg-blue-600",
  likes: "bg-rose-500",
  comments: "bg-emerald-500",
  saves: "bg-amber-500",
  shares: "bg-indigo-500",
};

export interface PerformanceChartProps {
  items: TikTokPerformanceItem[];
}

export function PerformanceChart({
  items,
}: PerformanceChartProps): React.JSX.Element {
  const [metric, setMetric] = useState<ChartMetric>("views");
  const chartData = computeTopPerformanceItems(items, 6, metric);

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-base font-semibold tracking-tight text-slate-900">
              Top Carrosséis por Engajamento
            </h3>
            <p className="text-xs text-slate-500">
              Ranking com todas as métricas de cada publicação.
            </p>
          </div>
        </div>

        <Tabs
          ariaLabel="Métrica do ranking"
          value={metric}
          onChange={(id) => setMetric(id as ChartMetric)}
          items={METRIC_TABS.map((tab) => ({
            id: tab.id,
            label: (
              <>
                {tab.icon}
                {tab.label}
              </>
            ),
          }))}
        />
      </div>

      {chartData.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">
          Sem dados suficientes para gerar o ranking de desempenho.
        </div>
      ) : (
        <ol className="flex flex-col divide-y divide-slate-100">
          {chartData.map((entry, index) => (
            <li
              key={entry.id}
              className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-3"
            >
              <span
                className={cn(
                  "flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold",
                  index === 0
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-500"
                )}
              >
                {index + 1}
              </span>

              <RankThumb
                storagePath={entry.coverStoragePath}
                slidesCount={entry.slidesCount}
                label={entry.label}
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="truncate text-sm font-semibold text-slate-800">
                    <span className="mr-1.5 font-medium text-blue-600">
                      @{entry.accountId}
                    </span>
                    {entry.label}
                  </span>
                  <span className="font-semibold text-slate-800">
                    {formatCompact(entry.value)}{" "}
                    <span className="text-xs font-normal text-slate-400">
                      {entry.metricLabel}
                    </span>
                  </span>
                </div>

                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      BAR_TONES[metric]
                    )}
                    style={{ width: `${Math.max(entry.percentage, 2)}%` }}
                  />
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <Chip
                    icon={<Eye className="h-3 w-3 text-blue-600" />}
                    label="Visualizações"
                    value={entry.views}
                  />
                  <Chip
                    icon={<Heart className="h-3 w-3 text-rose-500" />}
                    label="Curtidas"
                    value={entry.likes}
                  />
                  <Chip
                    icon={<MessageSquare className="h-3 w-3 text-emerald-600" />}
                    label="Comentários"
                    value={entry.comments}
                  />
                  <Chip
                    icon={<Bookmark className="h-3 w-3 text-amber-600" />}
                    label="Salvos"
                    value={entry.saves}
                  />
                  <Chip
                    icon={<Repeat2 className="h-3 w-3 text-indigo-500" />}
                    label="Compartilhamentos"
                    value={entry.shares}
                  />
                  {entry.videoUrl && (
                    <a
                      href={entry.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-[11px] font-semibold text-blue-600 hover:underline"
                    >
                      Ver no TikTok ↗
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
