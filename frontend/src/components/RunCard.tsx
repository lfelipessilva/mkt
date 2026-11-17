import React, { useState } from "react";
import type { Account, CarouselRun, CarouselSlide } from "../types";
import { ROLE_LABELS } from "../types";
import { AuthImage } from "./AuthImage";
import { dispatchCarouselRun, approveAutomationRun } from "../api";
import { orderSlides } from "../tabs/GalleryPage";
import { CarouselSlidesModal } from "./CarouselSlidesModal";
import {
  Send,
  CheckCircle2,
  Edit3,
  Share2,
  Layers,
  ChevronDown,
  ChevronUp,
  Eye,
  Heart,
  MessageSquare,
  Repeat2,
} from "lucide-react";
import {
  Badge,
  Button,
  InlineAlert,
  RoleBadge,
  StatusBadge,
  cn,
} from "../ui";

export interface RunCardMetrics {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  video_url?: string | null;
}

export interface RunCardProps {
  run: CarouselRun;
  account?: Account | null;
  metrics?: RunCardMetrics | null;
  onDispatched?: (updatedRun: CarouselRun) => void;
  onOpenManualPublish?: (run: CarouselRun) => void;
  onRunUpdated?: (run: CarouselRun) => void;
  onToast?: (message: string, type: "success" | "error" | "info") => void;
  isFocused?: boolean;
}

export const STATUS_LABELS: Record<string, string> = {
  generating: "Gerando",
  generated: "Gerado",
  awaiting_approval: "Aguardando aprovação",
  dispatching: "Despachando",
  dispatched: "Despachado",
  published: "Publicado",
  failed: "Falhou",
};

export function resolveRunCardClassName(status: string, isFocused?: boolean): string {
  return `run-card status-${status}${isFocused ? " run-card--focused" : ""}`;
}

export function resolveCoverSlide(slides: CarouselSlide[]): CarouselSlide | null {
  if (!slides || slides.length === 0) return null;
  const cover = slides.find((s) => s.position === 1);
  return cover || slides[0] || null;
}

export function formatCollapsedSlideCountBadge(count: number): string {
  if (count <= 0) return "Sem slides";
  if (count === 1) return "1 slide";
  return `${count} slides`;
}

export function formatCardMetrics(
  metrics?: RunCardMetrics | null
): { views: string; likes: string; comments: string; shares: string } | null {
  if (!metrics) return null;
  const hasAnyMetric =
    metrics.views !== undefined ||
    metrics.likes !== undefined ||
    metrics.comments !== undefined ||
    metrics.shares !== undefined;
  if (!hasAnyMetric) return null;

  return {
    views: Number(metrics.views || 0).toLocaleString("pt-BR"),
    likes: Number(metrics.likes || 0).toLocaleString("pt-BR"),
    comments: Number(metrics.comments || 0).toLocaleString("pt-BR"),
    shares: Number(metrics.shares || 0).toLocaleString("pt-BR"),
  };
}

function isZernioLinked(account: Account | null | undefined): boolean {
  return Boolean(
    account &&
      account.external_account_id &&
      account.external_account_id.trim() !== "" &&
      account.social_provider?.trim().toLowerCase() === "zernio"
  );
}

export function shouldShowTelegram(
  account: Account | null | undefined,
  run: CarouselRun
): boolean {
  if (!isZernioLinked(account)) return true;
  return resolveBufferPublishState(account, run).zernioFailed;
}

export function shouldShowManualTikTok(
  account: Account | null | undefined,
  run: CarouselRun
): boolean {
  const zernioManaged = Boolean(
    isZernioLinked(account) && run.tiktok_post?.external_post_id
  );
  if (!zernioManaged) return true;
  return resolveBufferPublishState(account, run).zernioFailed;
}

export interface RunCardPublishState {
  visible: boolean;
  disabled: boolean;
  label: string;
  published: boolean;
  zernioFailed: boolean;
}

export function resolveBufferPublishState(
  account: Account | null | undefined,
  run: CarouselRun
): RunCardPublishState {
  const isLinked = isZernioLinked(account);

  const postStatus = run.tiktok_post?.publish_status?.trim().toLowerCase();
  const published =
    postStatus === "published" || run.status === "published";
  const zernioFailed =
    postStatus === "failed" ||
    (!published && run.status === "failed");

  if (!isLinked) {
    return {
      visible: false,
      disabled: false,
      label: "",
      published,
      zernioFailed: false,
    };
  }

  if (published) {
    return {
      visible: true,
      disabled: true,
      label: "Publicado",
      published: true,
      zernioFailed: false,
    };
  }

  if (
    postStatus === "queued" ||
    postStatus === "processing" ||
    (run.buffer_dispatched_at && !zernioFailed)
  ) {
    return {
      visible: true,
      disabled: true,
      label: "Enviado ao Zernio",
      published: false,
      zernioFailed: false,
    };
  }

  if (zernioFailed) {
    return {
      visible: true,
      disabled: false,
      label: "Reenviar ao Zernio",
      published: false,
      zernioFailed: true,
    };
  }

  if (run.status === "awaiting_approval") {
    return {
      visible: true,
      disabled: false,
      label: "Confirmar envio",
      published: false,
      zernioFailed: false,
    };
  }

  return {
    visible: true,
    disabled: false,
    label: "Publicar no Zernio",
    published: false,
    zernioFailed: false,
  };
}

interface MetricProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function Metric({ icon, label, value }: MetricProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-center gap-1.5 px-2 py-2" title={label}>
      {icon}
      <span className="font-semibold text-slate-700">{value}</span>
    </div>
  );
}

export function RunCard({
  run,
  account,
  metrics,
  onDispatched,
  onOpenManualPublish,
  onRunUpdated,
  onToast,
  isFocused = false,
}: RunCardProps): React.JSX.Element {
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPublishingBuffer, setIsPublishingBuffer] = useState(false);
  const [bufferSuccess, setBufferSuccess] = useState<string | null>(null);
  const [bufferError, setBufferError] = useState<string | null>(null);
  const [expandedCaption, setExpandedCaption] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [slidesModalOpen, setSlidesModalOpen] = useState(false);

  const slides: CarouselSlide[] = orderSlides(run.slides || []);
  const coverSlide = resolveCoverSlide(slides);
  const formattedMetrics = formatCardMetrics(metrics);

  const formattedDate = run.created_at
    ? new Date(run.created_at).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";

  const isLinked = Boolean(
    account &&
    account.external_account_id &&
    account.external_account_id.trim() !== "" &&
    account.social_provider?.trim().toLowerCase() === "zernio"
  );

  const bufferState = resolveBufferPublishState(account, run);
  const showTelegram = shouldShowTelegram(account, run);
  const manualVisible =
    Boolean(onOpenManualPublish) && shouldShowManualTikTok(account, run);
  const tiktokUrl = metrics?.video_url || run.tiktok_post?.video_url || null;

  const handleSendTelegram = async () => {
    if (isSending) return;
    setIsSending(true);
    setSendError(null);
    setSendSuccess(false);

    try {
      const result = await dispatchCarouselRun(run.id, "telegram");
      setSendSuccess(true);
      const updated: CarouselRun = result.run || {
        ...run,
        status: "dispatched",
      };
      if (onDispatched) onDispatched(updated);
      if (onRunUpdated) onRunUpdated(updated);
      setTimeout(() => setSendSuccess(false), 4000);
    } catch (err: any) {
      setSendError(err.message || "Erro ao despachar carrossel via Telegram");
    } finally {
      setIsSending(false);
    }
  };

  const handlePublishBuffer = async () => {
    if (isPublishingBuffer || bufferState.disabled) return;
    setIsPublishingBuffer(true);
    setBufferError(null);
    setBufferSuccess(null);

    try {
      let updatedRun: CarouselRun;
      if (run.status === "awaiting_approval") {
        const result = await approveAutomationRun(run.id);
        updatedRun = result.run || {
          ...run,
          status: "dispatched",
          buffer_dispatched_at: new Date().toISOString(),
        };
      } else {
        const result = await dispatchCarouselRun(run.id, "zernio");
        updatedRun = result.run || {
          ...run,
          status: "dispatched",
          buffer_dispatched_at: new Date().toISOString(),
        };
      }
      setBufferSuccess(
        updatedRun.status === "published"
          ? "Publicado no TikTok via Zernio"
          : "Carrossel enviado ao Zernio"
      );
      if (onDispatched) onDispatched(updatedRun);
      if (onRunUpdated) onRunUpdated(updatedRun);
      if (onToast) {
        onToast(
          updatedRun.status === "published"
            ? "Publicado no TikTok via Zernio"
            : "Carrossel enviado ao Zernio",
          "success"
        );
      }
      setTimeout(() => setBufferSuccess(null), 4000);
    } catch (err: any) {
      const msg = err.message || "Erro ao publicar no Zernio";
      setBufferError(msg);
      if (onToast) onToast(msg, "error");
    } finally {
      setIsPublishingBuffer(false);
    }
  };

  return (
    <>
      <div
        id={`run-card-${run.id}`}
        className={cn(
          resolveRunCardClassName(run.status, isFocused),
          "flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md",
          isFocused
            ? "border-blue-500 ring-2 ring-blue-500/25"
            : "border-slate-200"
        )}
        data-testid={`run-card-${run.id}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-bold text-slate-900">
              @{run.account_id}
            </span>
            {run.account_role && (
              <RoleBadge
                role={run.account_role}
                label={ROLE_LABELS[run.account_role] || run.account_role}
              />
            )}
          </div>

          <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">
            {isLinked && (
              <Badge
                tone="blue"
                pill
                title={`Conta vinculada ao Zernio (${account?.external_account_id})`}
              >
                Zernio
              </Badge>
            )}
            <StatusBadge
              status={run.status}
              label={STATUS_LABELS[run.status] || run.status}
            />
          </div>
        </div>

        <div
          className={cn(
            "group relative",
            slides.length > 0 ? "cursor-pointer" : "cursor-default"
          )}
          onClick={() => {
            if (slides.length > 0) setSlidesModalOpen(true);
          }}
          role={slides.length > 0 ? "button" : undefined}
          tabIndex={slides.length > 0 ? 0 : undefined}
          onKeyDown={(e) => {
            if (slides.length > 0 && (e.key === "Enter" || e.key === " ")) {
              setSlidesModalOpen(true);
            }
          }}
          title={
            slides.length > 0
              ? "Clique para visualizar todos os slides"
              : undefined
          }
        >
          {coverSlide ? (
            <div className="relative">
              <div
                className="absolute inset-x-2.5 -top-1 h-4 rounded-t-lg border border-b-0 border-slate-200 bg-slate-100"
                aria-hidden="true"
              />
              <div className="relative h-[240px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                <AuthImage
                  storagePath={coverSlide.storage_path}
                  alt={`Capa do carrossel @${run.account_id}`}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
                <div className="pointer-events-none absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-slate-900/35 via-transparent to-slate-900/60 p-2.5">
                  <span className="inline-flex w-fit items-center gap-1 rounded-md border border-white/20 bg-slate-900/80 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                    <Layers className="h-3 w-3" />
                    {formatCollapsedSlideCountBadge(slides.length)}
                  </span>
                  <span className="self-end rounded-md bg-slate-900/80 px-2 py-0.5 text-[11px] font-medium text-slate-50 backdrop-blur transition-colors group-hover:bg-blue-600 group-hover:text-white">
                    Ver todos
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-[160px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
              Nenhum slide renderizado
            </div>
          )}
        </div>

        {formattedMetrics && (
          <div className="grid grid-cols-4 divide-x divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-xs">
            <Metric
              icon={<Eye className="h-3.5 w-3.5 text-blue-600" />}
              label="Visualizações"
              value={formattedMetrics.views}
            />
            <Metric
              icon={<Heart className="h-3.5 w-3.5 text-rose-500" />}
              label="Curtidas"
              value={formattedMetrics.likes}
            />
            <Metric
              icon={<MessageSquare className="h-3.5 w-3.5 text-emerald-600" />}
              label="Comentários"
              value={formattedMetrics.comments}
            />
            <Metric
              icon={<Repeat2 className="h-3.5 w-3.5 text-indigo-500" />}
              label="Compartilhamentos"
              value={formattedMetrics.shares}
            />
          </div>
        )}

        {run.legenda && (
          <div className="rounded-r-lg border-l-2 border-blue-500 bg-slate-50 px-3 py-2.5">
            <p
              className={cn(
                "whitespace-pre-wrap text-xs leading-relaxed text-slate-600",
                !expandedCaption && "line-clamp-2"
              )}
            >
              {run.legenda}
            </p>
            {run.legenda.length > 90 && (
              <button
                type="button"
                className="mt-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                onClick={() => setExpandedCaption(!expandedCaption)}
              >
                {expandedCaption ? "Ver menos" : "Ver legenda completa"}
              </button>
            )}
          </div>
        )}

        <div className="border-t border-slate-100 pt-1">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 py-1 text-xs text-slate-500 transition-colors hover:text-slate-800"
            onClick={() => setShowDetails(!showDetails)}
          >
            <span>
              {showDetails
                ? "Ocultar detalhes"
                : "Ver detalhes (tema, arquétipo)"}
            </span>
            {showDetails ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>

          {showDetails && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2 text-xs">
              <dt className="font-medium text-slate-400">Arquétipo:</dt>
              <dd className="font-medium text-slate-700">
                {run.archetype_title}
              </dd>
              {run.tema && (
                <>
                  <dt className="font-medium text-slate-400">Tema:</dt>
                  <dd className="text-slate-600">{run.tema}</dd>
                </>
              )}
              {run.tiktok_post?.external_post_id && (
                <>
                  <dt className="font-medium text-slate-400">Zernio:</dt>
                  <dd className="break-all font-mono text-slate-600">
                    {run.tiktok_post.external_post_id}
                  </dd>
                </>
              )}
              {run.bait_body && (
                <>
                  <dt className="font-medium text-slate-400">Isca:</dt>
                  <dd className="italic text-slate-600">"{run.bait_body}"</dd>
                </>
              )}
              {formattedDate && (
                <>
                  <dt className="font-medium text-slate-400">Criado:</dt>
                  <dd className="text-slate-500">{formattedDate}</dd>
                </>
              )}
            </dl>
          )}
        </div>

        {sendError && <InlineAlert tone="error">{sendError}</InlineAlert>}
        {sendSuccess && (
          <InlineAlert tone="success">
            Carrossel despachado com sucesso via Telegram!
          </InlineAlert>
        )}
        {bufferError && <InlineAlert tone="error">{bufferError}</InlineAlert>}
        {bufferSuccess && (
          <InlineAlert tone="success">{bufferSuccess}</InlineAlert>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
          {bufferState.visible && (
            <Button
              variant={bufferState.disabled ? "outline" : "primary"}
              size="sm"
              disabled={bufferState.disabled}
              isLoading={isPublishingBuffer}
              onClick={handlePublishBuffer}
              title={bufferState.label}
            >
              {!isPublishingBuffer && <Share2 className="h-3.5 w-3.5" />}
              <span>{isPublishingBuffer ? "Enviando..." : bufferState.label}</span>
            </Button>
          )}

          {showTelegram && (
            <Button
              variant="secondary"
              size="sm"
              isLoading={isSending}
              onClick={handleSendTelegram}
              title={
                bufferState.zernioFailed
                  ? "Fallback: enviar carrossel para o Telegram"
                  : "Enviar carrossel para o Telegram"
              }
            >
              {!isSending && <Send className="h-3.5 w-3.5" />}
              <span>{isSending ? "Enviando..." : "Telegram"}</span>
            </Button>
          )}

          {tiktokUrl && (
            <a
              href={tiktokUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
              title="Abrir no TikTok"
            >
              Ver no TikTok ↗
            </a>
          )}

          {manualVisible && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenManualPublish && onOpenManualPublish(run)}
            >
              {run.status === "published" ? (
                <>
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Editar TikTok</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Publicado TikTok</span>
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      <CarouselSlidesModal
        isOpen={slidesModalOpen}
        run={run}
        onClose={() => setSlidesModalOpen(false)}
      />
    </>
  );
}
