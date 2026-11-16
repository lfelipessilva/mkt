import React, { useState, useEffect } from "react";
import type { CarouselRun, TikTokPerformanceItem, TikTokPost, UpsertTikTokPostInput } from "../types";
import { upsertTikTokPost } from "../api";
import { X } from "lucide-react";

export function validateManualTikTokInput(input: {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  video_url?: string | null;
}): { valid: boolean; error?: string } {
  if (input.views !== undefined && input.views < 0) {
    return { valid: false, error: "Visualizações não pode ser negativo" };
  }
  if (input.likes !== undefined && input.likes < 0) {
    return { valid: false, error: "Curtidas não pode ser negativo" };
  }
  if (input.comments !== undefined && input.comments < 0) {
    return { valid: false, error: "Comentários não pode ser negativo" };
  }
  if (input.shares !== undefined && input.shares < 0) {
    return { valid: false, error: "Compartilhamentos não pode ser negativo" };
  }
  return { valid: true };
}

export interface ManualTikTokModalProps {
  isOpen: boolean;
  run?: CarouselRun | null;
  performanceItem?: TikTokPerformanceItem | null;
  onClose: () => void;
  onSuccess: (updatedRun: CarouselRun, post: TikTokPost) => void;
}

export function ManualTikTokModal({
  isOpen,
  run,
  performanceItem,
  onClose,
  onSuccess,
}: ManualTikTokModalProps): React.JSX.Element | null {
  const targetRunId = run?.id || performanceItem?.run_id || performanceItem?.id || "";
  const targetAccountId = run?.account_id || performanceItem?.account_id || "";
  const targetArchetype = run?.archetype_title || performanceItem?.archetype_title || "";
  const targetTema = run?.tema || performanceItem?.tema || "";

  const [videoUrl, setVideoUrl] = useState("");
  const [videoId, setVideoId] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [views, setViews] = useState<number>(0);
  const [likes, setLikes] = useState<number>(0);
  const [comments, setComments] = useState<number>(0);
  const [shares, setShares] = useState<number>(0);
  const [metricsNote, setMetricsNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      // Pre-fill from existing performanceItem or defaults
      if (performanceItem) {
        setVideoUrl(performanceItem.video_url || "");
        setVideoId(performanceItem.video_id || "");
        setViews(performanceItem.views ?? 0);
        setLikes(performanceItem.likes ?? 0);
        setComments(performanceItem.comments ?? 0);
        setShares(performanceItem.shares ?? 0);
        setMetricsNote(performanceItem.metrics_note || "");
        if (performanceItem.published_at) {
          try {
            const d = new Date(performanceItem.published_at);
            setPublishedAt(d.toISOString().slice(0, 16));
          } catch {
            setPublishedAt("");
          }
        } else {
          setPublishedAt(new Date().toISOString().slice(0, 16));
        }
      } else {
        setVideoUrl("");
        setVideoId("");
        setViews(0);
        setLikes(0);
        setComments(0);
        setShares(0);
        setMetricsNote("");
        setPublishedAt(new Date().toISOString().slice(0, 16));
      }
    }
  }, [isOpen, performanceItem]);

  if (!isOpen || !targetRunId) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const validation = validateManualTikTokInput({
      views,
      likes,
      comments,
      shares,
      video_url: videoUrl,
    });

    if (!validation.valid) {
      setErrorMessage(validation.error || "Dados inválidos");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: UpsertTikTokPostInput = {
        video_url: videoUrl.trim() || null,
        video_id: videoId.trim() || null,
        published_at: publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString(),
        views: Number(views) || 0,
        likes: Number(likes) || 0,
        comments: Number(comments) || 0,
        shares: Number(shares) || 0,
        metrics_note: metricsNote.trim() || null,
        tracking_mode: "manual",
      };

      const result = await upsertTikTokPost(targetRunId, payload);
      onSuccess(result.run, result.post);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Erro ao salvar publicação manual do TikTok");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-card manual-tiktok-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h4>Marcar como Publicado Manualmente</h4>
            <span className="modal-subtitle">
              Conta: @{targetAccountId} {targetArchetype ? `• ${targetArchetype}` : ""}
            </span>
          </div>
          <button
            type="button"
            className="modal-close-btn p-1.5 hover:bg-slate-100 rounded-md transition-colors"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {errorMessage && (
            <div className="form-error-alert" role="alert">
              {errorMessage}
            </div>
          )}

          {targetTema && (
            <div className="run-preview-box">
              <span className="preview-label">Tema:</span>
              <span className="preview-value">{targetTema}</span>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="tiktok-video-url">URL da Publicação no TikTok</label>
            <input
              id="tiktok-video-url"
              type="url"
              placeholder="https://www.tiktok.com/@conta/video/..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              disabled={isSubmitting}
            />
            <span className="form-hint">
              Link do vídeo publicado no TikTok (opcional, mas recomendado).
            </span>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="tiktok-published-at">Data e Hora da Publicação</label>
              <input
                id="tiktok-published-at"
                type="datetime-local"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div className="form-group">
              <label htmlFor="tiktok-video-id">ID do Vídeo (Opcional)</label>
              <input
                id="tiktok-video-id"
                type="text"
                placeholder="Ex: 7391823901..."
                value={videoId}
                onChange={(e) => setVideoId(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="metrics-inputs-section">
            <label className="section-label">Métricas Atuais</label>
            <div className="metrics-grid">
              <div className="metric-input-field">
                <label htmlFor="metric-views">Visualizações</label>
                <input
                  id="metric-views"
                  type="number"
                  min="0"
                  value={views}
                  onChange={(e) => setViews(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  disabled={isSubmitting}
                />
              </div>

              <div className="metric-input-field">
                <label htmlFor="metric-likes">Curtidas</label>
                <input
                  id="metric-likes"
                  type="number"
                  min="0"
                  value={likes}
                  onChange={(e) => setLikes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  disabled={isSubmitting}
                />
              </div>

              <div className="metric-input-field">
                <label htmlFor="metric-comments">Comentários</label>
                <input
                  id="metric-comments"
                  type="number"
                  min="0"
                  value={comments}
                  onChange={(e) => setComments(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  disabled={isSubmitting}
                />
              </div>

              <div className="metric-input-field">
                <label htmlFor="metric-shares">Compartilhamentos</label>
                <input
                  id="metric-shares"
                  type="number"
                  min="0"
                  value={shares}
                  onChange={(e) => setShares(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="tiktok-note">Notas / Observações</label>
            <textarea
              id="tiktok-note"
              rows={2}
              placeholder="Ex: Teve alto engajamento nos primeiros 30 minutos..."
              value={metricsNote}
              onChange={(e) => setMetricsNote(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Salvando..." : "Salvar Publicação"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
