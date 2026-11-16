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
  AlertCircle,
  Check,
  Share2,
  Layers,
  ChevronDown,
  ChevronUp,
  Eye,
  Heart,
  MessageSquare,
  Repeat2,
} from "lucide-react";

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

export function resolveBufferPublishState(
  account: Account | null | undefined,
  run: CarouselRun
): { visible: boolean; disabled: boolean; label: string } {
  const isLinked = Boolean(
    account &&
    account.external_account_id &&
    account.external_account_id.trim() !== "" &&
    (!account.social_provider || account.social_provider.trim() === "" || account.social_provider.trim().toLowerCase() === "buffer")
  );

  // 1. Se run.buffer_dispatched_at existe e run.status !== 'failed' → visible: true, disabled: true, label 'Enviado ao Buffer'
  if (run.buffer_dispatched_at && run.status !== "failed") {
    return { visible: true, disabled: true, label: "Enviado ao Buffer" };
  }

  // 2. Se run.buffer_dispatched_at existe e run.status === 'failed' → visible: true, disabled: false, label 'Reenviar ao Buffer'
  if (run.buffer_dispatched_at && run.status === "failed") {
    return { visible: true, disabled: false, label: "Reenviar ao Buffer" };
  }

  // 3. Se run está aguardando aprovação da rotina (status = 'awaiting_approval' ou slot vinculado em awaiting_approval)
  if (run.status === "awaiting_approval") {
    return { visible: true, disabled: false, label: "Confirmar envio" };
  }

  // Conta sem vínculo → invisível
  if (!isLinked) {
    return { visible: false, disabled: false, label: "" };
  }

  // 4. Se não existe buffer_dispatched_at e run.status === 'published' → visible: true, disabled: true, label 'Já publicado'
  if (run.status === "published") {
    return { visible: true, disabled: true, label: "Já publicado" };
  }

  // 5. Se não existe buffer_dispatched_at, a conta está vinculada e o run não está published → visible: true, disabled: false, label 'Publicar no Buffer'
  return { visible: true, disabled: false, label: "Publicar no Buffer" };
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
  const [bufferSuccess, setBufferSuccess] = useState(false);
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
    (!account.social_provider || account.social_provider.trim() === "" || account.social_provider.trim().toLowerCase() === "buffer")
  );

  const bufferState = resolveBufferPublishState(account, run);

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
    setBufferSuccess(false);

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
        const result = await dispatchCarouselRun(run.id, "buffer");
        updatedRun = result.run || {
          ...run,
          status: "dispatched",
          buffer_dispatched_at: new Date().toISOString(),
        };
      }
      setBufferSuccess(true);
      if (onDispatched) onDispatched(updatedRun);
      if (onRunUpdated) onRunUpdated(updatedRun);
      if (onToast) onToast("Carrossel enviado ao Buffer", "success");
      setTimeout(() => setBufferSuccess(false), 4000);
    } catch (err: any) {
      const msg = err.message || "Erro ao publicar no Buffer";
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
        className={resolveRunCardClassName(run.status, isFocused)}
        data-testid={`run-card-${run.id}`}
      >
        {/* Top Header */}
        <div className="run-card-header">
          <div className="run-card-account">
            <span className="account-handle font-semibold">@{run.account_id}</span>
            {run.account_role && (
              <span className="account-role-tag">
                {ROLE_LABELS[run.account_role] || run.account_role}
              </span>
            )}
          </div>

          <div className="run-card-badges flex items-center gap-1.5">
            {isLinked && (
              <span className="buffer-badge" title={`Conta vinculada ao Buffer (${account?.external_account_id})`}>
                Buffer
              </span>
            )}
            <span className={`status-pill status-${run.status}`}>
              {STATUS_LABELS[run.status] || run.status}
            </span>
          </div>
        </div>

        {/* Collapsed Images Section */}
        <div
          className={`run-collapsed-media-wrapper ${slides.length > 0 ? "cursor-pointer group" : "cursor-default"}`}
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
          title={slides.length > 0 ? "Clique para visualizar todos os slides" : undefined}
        >
          {coverSlide ? (
            <div className="run-collapsed-media-stack">
              <div className="run-collapsed-cover-thumb">
                <AuthImage
                  storagePath={coverSlide.storage_path}
                  alt={`Capa do carrossel @${run.account_id}`}
                  className="run-collapsed-img"
                />
                <div className="run-collapsed-overlay">
                  <span className="run-collapsed-badge">
                    <Layers className="w-3.5 h-3.5 inline mr-1" />
                    {formatCollapsedSlideCountBadge(slides.length)}
                  </span>
                  <span className="run-collapsed-hint">Ver todos</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="run-collapsed-empty">
              <span>Nenhum slide renderizado</span>
            </div>
          )}
        </div>

        {/* Optional Metrics Row */}
        {formattedMetrics && (
          <div className="run-card-metrics-row flex items-center justify-between text-xs bg-slate-50 rounded px-2.5 py-1.5 border border-slate-100">
            <div className="flex items-center gap-1 text-slate-700" title="Visualizações">
              <Eye className="w-3.5 h-3.5 text-blue-600" />
              <span className="font-medium">{formattedMetrics.views}</span>
            </div>
            <div className="flex items-center gap-1 text-slate-700" title="Curtidas">
              <Heart className="w-3.5 h-3.5 text-rose-500" />
              <span className="font-medium">{formattedMetrics.likes}</span>
            </div>
            <div className="flex items-center gap-1 text-slate-700" title="Comentários">
              <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
              <span className="font-medium">{formattedMetrics.comments}</span>
            </div>
            <div className="flex items-center gap-1 text-slate-700" title="Compartilhamentos">
              <Repeat2 className="w-3.5 h-3.5 text-indigo-500" />
              <span className="font-medium">{formattedMetrics.shares}</span>
            </div>
          </div>
        )}

        {/* Primary Description (Legenda) */}
        {run.legenda && (
          <div className="run-card-caption">
            <p className={`caption-text ${expandedCaption ? "expanded" : "collapsed"}`}>
              {run.legenda}
            </p>
            {run.legenda.length > 90 && (
              <button
                type="button"
                className="btn-toggle-caption text-blue-600 hover:text-blue-800"
                onClick={() => setExpandedCaption(!expandedCaption)}
              >
                {expandedCaption ? "Ver menos" : "Ver legenda completa"}
              </button>
            )}
          </div>
        )}

        {/* Secondary Details Accordion */}
        <div className="run-card-secondary-details">
          <button
            type="button"
            className="btn-toggle-details flex items-center justify-between w-full text-xs text-slate-500 hover:text-slate-700 py-1"
            onClick={() => setShowDetails(!showDetails)}
          >
            <span>{showDetails ? "Ocultar detalhes" : "Ver detalhes (tema, arquétipo)"}</span>
            {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showDetails && (
            <div className="run-card-meta-collapsible mt-1.5 pt-1.5 border-t border-slate-100 text-xs flex flex-col gap-1">
              <div className="meta-row">
                <span className="meta-label text-slate-400">Arquétipo:</span>
                <span className="meta-title font-medium text-slate-700">{run.archetype_title}</span>
              </div>
              {run.tema && (
                <div className="meta-row">
                  <span className="meta-label text-slate-400">Tema:</span>
                  <span className="meta-tema text-slate-600">{run.tema}</span>
                </div>
              )}
              {run.bait_body && (
                <div className="meta-row">
                  <span className="meta-label text-slate-400">Isca:</span>
                  <span className="meta-bait text-slate-600 italic">"{run.bait_body}"</span>
                </div>
              )}
              {formattedDate && (
                <div className="meta-row">
                  <span className="meta-label text-slate-400">Criado:</span>
                  <span className="meta-date text-slate-500">{formattedDate}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Alerts */}
        {sendError && (
          <div className="run-card-alert error flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span>{sendError}</span>
          </div>
        )}
        {sendSuccess && (
          <div className="run-card-alert success flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>Carrossel despachado com sucesso via Telegram!</span>
          </div>
        )}
        {bufferError && (
          <div className="run-card-alert error flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span>{bufferError}</span>
          </div>
        )}
        {bufferSuccess && (
          <div className="run-card-alert success flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>Carrossel enviado ao Buffer</span>
          </div>
        )}

        {/* Actions Bar */}
        <div className="run-card-actions">
          <button
            type="button"
            className="btn btn-secondary btn-send flex items-center gap-1.5"
            disabled={isSending}
            onClick={handleSendTelegram}
            title="Enviar carrossel para o Telegram"
          >
            {isSending ? (
              <>
                <span className="spinner-sm" />
                <span>Enviando...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Telegram</span>
              </>
            )}
          </button>

          {bufferState.visible && (
            <button
              type="button"
              className="btn btn-secondary btn-buffer flex items-center gap-1.5"
              disabled={bufferState.disabled || isPublishingBuffer}
              onClick={handlePublishBuffer}
              title={bufferState.label}
            >
              {isPublishingBuffer ? (
                <>
                  <span className="spinner-sm" />
                  <span>Enviando...</span>
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5" />
                  <span>{bufferState.label}</span>
                </>
              )}
            </button>
          )}

          {metrics?.video_url && (
            <a
              href={metrics.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary flex items-center gap-1.5 text-xs"
              title="Abrir no TikTok"
            >
              <span>Ver ↗</span>
            </a>
          )}

          <button
            type="button"
            className={`btn ${run.status === "published" ? "btn-outline" : "btn-primary"} btn-publish-tiktok flex items-center gap-1.5`}
            onClick={() => onOpenManualPublish && onOpenManualPublish(run)}
          >
            {run.status === "published" ? (
              <>
                <Edit3 className="w-3.5 h-3.5" />
                <span>Editar TikTok</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Publicado TikTok</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Modal displaying all slides */}
      <CarouselSlidesModal
        isOpen={slidesModalOpen}
        run={run}
        onClose={() => setSlidesModalOpen(false)}
      />
    </>
  );
}
