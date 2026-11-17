import React, { useMemo, useState } from "react";
import type { Account, CarouselRun, TikTokPerformanceItem } from "../types";
import { ROLE_LABELS } from "../types";
import { AuthImage } from "./AuthImage";
import { CarouselSlidesModal } from "./CarouselSlidesModal";
import { orderSlides } from "../tabs/GalleryPage";
import {
  Bookmark,
  Check,
  Copy,
  Edit3,
  Eye,
  Heart,
  Layers,
  MessageSquare,
  Repeat2,
  Sparkles,
} from "lucide-react";
import { Badge, Button, RoleBadge, cn } from "../ui";

export interface PerformanceCardProps {
  item: TikTokPerformanceItem;
  account?: Account | null;
  onEdit: (item: TikTokPerformanceItem) => void;
}

export function buildPerformanceRun(item: TikTokPerformanceItem): CarouselRun {
  if (item.run) return item.run;
  return {
    id: item.run_id,
    account_id: item.account_id,
    account_role: item.account_role as CarouselRun["account_role"],
    archetype_title: item.archetype_title,
    tema: item.tema,
    bait_body: item.bait_body,
    legenda: item.legenda,
    status: (item.status as CarouselRun["status"]) || "published",
    output_dir: item.output_dir,
    slides: [],
  };
}

export function computeEngagementRate(item: TikTokPerformanceItem): number {
  const views = Number(item.views) || 0;
  if (views <= 0) return 0;
  const interactions =
    (Number(item.likes) || 0) +
    (Number(item.comments) || 0) +
    (Number(item.saves) || 0) +
    (Number(item.shares) || 0);
  return (interactions / views) * 100;
}

function formatNumber(value: number | null | undefined): string {
  return Number(value || 0).toLocaleString("pt-BR");
}

function formatDate(value?: string | null): string {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

interface MetricTileProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: string;
}

function MetricTile({
  icon,
  label,
  value,
  tone,
}: MetricTileProps): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-0.5 px-1 py-2 text-center"
      title={label}
    >
      <span className={cn("flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide", tone)}>
        {icon}
      </span>
      <span className="font-mono text-sm font-bold leading-tight text-slate-800">
        {formatNumber(value)}
      </span>
      <span className="text-[9px] uppercase tracking-wide text-slate-400">
        {label}
      </span>
    </div>
  );
}

export function PerformanceCard({
  item,
  account,
  onEdit,
}: PerformanceCardProps): React.JSX.Element {
  const [slidesModalOpen, setSlidesModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = useMemo(() => buildPerformanceRun(item), [item]);
  const slides = orderSlides(run.slides || []);
  const cover = slides.find((slide) => slide.position === 1) ?? slides[0] ?? null;
  const engagementRate = computeEngagementRate(item);
  const title = item.tema || item.archetype_title;
  const displayName = item.account_display_name || account?.display_name || null;

  const handleCopyId = async () => {
    if (!item.external_post_id) return;
    try {
      await navigator.clipboard.writeText(item.external_post_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <>
      <article
        className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
        data-testid={`performance-card-${item.id}`}
      >
        <div
          className={cn(
            "group relative h-[200px] flex-none overflow-hidden bg-slate-100",
            slides.length > 0 ? "cursor-pointer" : "cursor-default"
          )}
          onClick={() => {
            if (slides.length > 0) setSlidesModalOpen(true);
          }}
          role={slides.length > 0 ? "button" : undefined}
          tabIndex={slides.length > 0 ? 0 : undefined}
          onKeyDown={(event) => {
            if (
              slides.length > 0 &&
              (event.key === "Enter" || event.key === " ")
            ) {
              setSlidesModalOpen(true);
            }
          }}
          title={slides.length > 0 ? "Ver todos os slides" : undefined}
        >
          {cover ? (
            <AuthImage
              storagePath={cover.storage_path}
              alt={`Capa do carrossel ${title}`}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-slate-400">
              <Layers className="h-5 w-5" />
              <span>Sem capa disponível</span>
            </div>
          )}

          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-slate-900/30 via-transparent to-slate-900/70 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-slate-900/80 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                <Layers className="h-3 w-3" />
                {slides.length > 0
                  ? `${slides.length} ${slides.length === 1 ? "slide" : "slides"}`
                  : "Sem slides"}
              </span>
              <Badge
                tone={item.tracking_mode === "manual" ? "amber" : "blue"}
                pill
                className="border-white/20 bg-white/90 backdrop-blur"
              >
                {item.tracking_mode === "manual" ? "Manual" : "Zernio / API"}
              </Badge>
            </div>

            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-white">
                  @{item.account_id}
                </div>
                {displayName && (
                  <div className="truncate text-[11px] text-white/80">
                    {displayName}
                  </div>
                )}
              </div>
              <span className="flex-none rounded-md bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-700 backdrop-blur">
                {formatDate(item.published_at)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-slate-900" title={title}>
                {title}
              </h3>
              {item.tema && item.archetype_title && (
                <p className="truncate text-[11px] text-slate-500">
                  {item.archetype_title}
                </p>
              )}
            </div>
            {item.account_role && (
              <RoleBadge
                role={item.account_role as keyof typeof ROLE_LABELS}
                label={
                  ROLE_LABELS[item.account_role as keyof typeof ROLE_LABELS] ||
                  item.account_role
                }
                className="flex-none"
              />
            )}
          </div>

          <div className="grid grid-cols-5 divide-x divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            <MetricTile
              icon={<Eye className="h-3 w-3" />}
              label="Views"
              value={Number(item.views) || 0}
              tone="text-blue-600"
            />
            <MetricTile
              icon={<Heart className="h-3 w-3" />}
              label="Curtidas"
              value={Number(item.likes) || 0}
              tone="text-rose-500"
            />
            <MetricTile
              icon={<MessageSquare className="h-3 w-3" />}
              label="Coments."
              value={Number(item.comments) || 0}
              tone="text-emerald-600"
            />
            <MetricTile
              icon={<Bookmark className="h-3 w-3" />}
              label="Salvos"
              value={Number(item.saves) || 0}
              tone="text-amber-600"
            />
            <MetricTile
              icon={<Repeat2 className="h-3 w-3" />}
              label="Shares"
              value={Number(item.shares) || 0}
              tone="text-indigo-500"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg bg-indigo-50/60 px-2.5 py-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1 font-semibold text-indigo-700">
              <Sparkles className="h-3 w-3" />
              Taxa de engajamento
            </span>
            <span className="font-mono font-bold text-indigo-800">
              {engagementRate.toFixed(2)}%
            </span>
          </div>

          {item.legenda && (
            <p className="whitespace-pre-wrap rounded-r-lg border-l-2 border-blue-500 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
              {item.legenda}
            </p>
          )}

          {item.metrics_note && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              <strong>Nota:</strong> {item.metrics_note}
            </p>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
            {item.external_post_id && (
              <>
                <dt className="font-medium text-slate-400">ID Zernio:</dt>
                <dd className="flex min-w-0 items-center gap-1">
                  <code
                    className="truncate font-mono text-slate-600"
                    title={item.external_post_id}
                  >
                    {item.external_post_id}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyId}
                    className="flex-none text-slate-400 transition-colors hover:text-slate-700"
                    title="Copiar ID"
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                  {item.publish_status && (
                    <span className="flex-none uppercase tracking-wide text-slate-400">
                      {item.publish_status}
                    </span>
                  )}
                </dd>
              </>
            )}
            <dt className="font-medium text-slate-400">Publicado:</dt>
            <dd className="text-slate-600">{formatDate(item.published_at)}</dd>
            {item.video_id && (
              <>
                <dt className="font-medium text-slate-400">Video ID:</dt>
                <dd className="truncate font-mono text-slate-600">{item.video_id}</dd>
              </>
            )}
          </dl>

          <div className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(item)}
              title="Editar métricas"
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span>Editar métricas</span>
            </Button>
            {item.video_url && (
              <a
                href={item.video_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
                title="Abrir no TikTok"
              >
                Ver no TikTok ↗
              </a>
            )}
          </div>
        </div>
      </article>

      <CarouselSlidesModal
        isOpen={slidesModalOpen}
        run={run}
        onClose={() => setSlidesModalOpen(false)}
      />
    </>
  );
}
