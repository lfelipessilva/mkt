import React, { useState } from "react";
import type { CarouselRun, CarouselSlide } from "../types";
import { ROLE_LABELS } from "../types";
import { AuthImage } from "./AuthImage";
import { dispatchCarouselRun } from "../api";
import { orderSlides } from "../tabs/GalleryPage";

export interface RunCardProps {
  run: CarouselRun;
  onDispatched?: (updatedRun: CarouselRun) => void;
  onOpenManualPublish?: (run: CarouselRun) => void;
  onRunUpdated?: (run: CarouselRun) => void;
}

export const STATUS_LABELS: Record<string, string> = {
  generating: "Gerando",
  generated: "Gerado",
  dispatching: "Despachando",
  dispatched: "Despachado",
  published: "Publicado",
  failed: "Falhou",
};

export function RunCard({
  run,
  onDispatched,
  onOpenManualPublish,
  onRunUpdated,
}: RunCardProps): React.JSX.Element {
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [expandedCaption, setExpandedCaption] = useState(false);

  const slides: CarouselSlide[] = orderSlides(run.slides || []);
  const formattedDate = run.created_at
    ? new Date(run.created_at).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";

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

  return (
    <div className={`run-card status-${run.status}`} data-testid={`run-card-${run.id}`}>
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

        <div className="run-card-badges">
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
                className="btn-toggle-caption"
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
          <span className="filmstrip-title">Slides ({slides.length})</span>
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
        <div className="run-card-alert error">
          <span>{sendError}</span>
        </div>
      )}
      {sendSuccess && (
        <div className="run-card-alert success">
          <span>✓ Carrossel despachado com sucesso via Telegram!</span>
        </div>
      )}

      {/* Actions */}
      <div className="run-card-actions">
        <button
          type="button"
          className="btn btn-secondary btn-send"
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
              <span>✈ Enviar (Telegram)</span>
            </>
          )}
        </button>

        <button
          type="button"
          className={`btn ${run.status === "published" ? "btn-outline" : "btn-primary"} btn-publish-tiktok`}
          onClick={() => onOpenManualPublish && onOpenManualPublish(run)}
        >
          {run.status === "published" ? "✎ Editar TikTok" : "✓ Publicado TikTok"}
        </button>
      </div>
    </div>
  );
}
