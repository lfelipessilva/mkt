import React, { useState } from "react";
import type { Account, CarouselRun, CarouselSlide } from "../types";
import { ROLE_LABELS } from "../types";
import { AuthImage } from "./AuthImage";
import { dispatchCarouselRun, approveAutomationRun } from "../api";
import { orderSlides } from "../tabs/GalleryPage";
import { Send, CheckCircle2, Edit3, AlertCircle, Check, Share2 } from "lucide-react";

export interface RunCardProps {
  run: CarouselRun;
  account?: Account | null;
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

  const slides: CarouselSlide[] = orderSlides(run.slides || []);
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
    <div
      id={`run-card-${run.id}`}
      className={resolveRunCardClassName(run.status, isFocused)}
      data-testid={`run-card-${run.id}`}
    >
      {/* Top Header */}
      <div className="run-card-header">
        <div className="run-card-account">
          <span className="account-handle">@{run.account_id}</span>
          {run.account_role && (
            <span className="account-role-tag">
              {ROLE_LABELS[run.account_role] || run.account_role}
            </span>
          )}
          {formattedDate && <span className="run-timestamp">{formattedDate}</span>}
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

      {/* Content Meta */}
      <div className="run-card-meta">
        <div className="meta-row">
          <span className="meta-label">Arquétipo:</span>
          <span className="meta-title">{run.archetype_title}</span>
        </div>

        {run.tema && (
          <div className="meta-row">
            <span className="meta-label">Tema:</span>
            <span className="meta-tema">{run.tema}</span>
          </div>
        )}

        {run.bait_body && (
          <div className="meta-row">
            <span className="meta-label">Isca:</span>
            <span className="meta-bait">"{run.bait_body}"</span>
          </div>
        )}

        {run.legenda && (
          <div className="run-card-caption">
            <p className={`caption-text ${expandedCaption ? "expanded" : "collapsed"}`}>
              {run.legenda}
            </p>
            {run.legenda.length > 120 && (
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
      </div>

      {/* Filmstrip */}
      <div className="run-filmstrip-section">
        <div className="filmstrip-header">
          <span className="filmstrip-title font-medium text-slate-700">Slides ({slides.length})</span>
        </div>

        {slides.length === 0 ? (
          <div className="filmstrip-empty">
            <span>Nenhum slide renderizado para este carrossel.</span>
          </div>
        ) : (
          <div className="run-filmstrip" role="list">
            {slides.map((slide) => (
              <div
                key={slide.id || slide.position}
                className="filmstrip-slide"
                role="listitem"
              >
                <div className="slide-thumb-wrapper">
                  <AuthImage
                    storagePath={slide.storage_path}
                    alt={`Slide ${slide.position}`}
                    className="slide-thumb-img"
                  />
                  <span className="slide-number-badge">
                    {slide.position === 1 ? "1 (Capa)" : slide.position}
                  </span>
                </div>
              </div>
            ))}
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

      {/* Actions */}
      <div className="run-card-actions">
        <button
          type="button"
          className="btn btn-secondary btn-send flex items-center gap-1.5"
          disabled={isSending}
          onClick={handleSendTelegram}
          title="Enviar carrossel para o Telegram configurado"
        >
          {isSending ? (
            <>
              <span className="spinner-sm" />
              <span>Enviando...</span>
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span>Enviar (Telegram)</span>
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
  );
}
