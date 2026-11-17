import React, { useState, useEffect } from "react";
import type {
  CarouselRun,
  TikTokPerformanceItem,
  TikTokPost,
  UpsertTikTokPostInput,
} from "../types";
import { upsertTikTokPost } from "../api";
import {
  Button,
  Field,
  InlineAlert,
  Input,
  Modal,
  Textarea,
} from "../ui";

export function validateManualTikTokInput(input: {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
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
  if (input.saves !== undefined && input.saves < 0) {
    return { valid: false, error: "Salvos não pode ser negativo" };
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

function MetricInput({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        min="0"
        className="font-mono"
        value={value}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
        disabled={disabled}
      />
    </Field>
  );
}

export function ManualTikTokModal({
  isOpen,
  run,
  performanceItem,
  onClose,
  onSuccess,
}: ManualTikTokModalProps): React.JSX.Element | null {
  const targetRunId =
    run?.id || performanceItem?.run_id || performanceItem?.id || "";
  const targetAccountId = run?.account_id || performanceItem?.account_id || "";
  const targetArchetype =
    run?.archetype_title || performanceItem?.archetype_title || "";
  const targetTema = run?.tema || performanceItem?.tema || "";

  const [videoUrl, setVideoUrl] = useState("");
  const [videoId, setVideoId] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [views, setViews] = useState<number>(0);
  const [likes, setLikes] = useState<number>(0);
  const [comments, setComments] = useState<number>(0);
  const [shares, setShares] = useState<number>(0);
  const [saves, setSaves] = useState<number>(0);
  const [metricsNote, setMetricsNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      if (performanceItem) {
        setVideoUrl(performanceItem.video_url || "");
        setVideoId(performanceItem.video_id || "");
        setViews(performanceItem.views ?? 0);
        setLikes(performanceItem.likes ?? 0);
        setComments(performanceItem.comments ?? 0);
        setShares(performanceItem.shares ?? 0);
        setSaves(performanceItem.saves ?? 0);
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
        setSaves(0);
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
      saves,
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
        published_at: publishedAt
          ? new Date(publishedAt).toISOString()
          : new Date().toISOString(),
        views: Number(views) || 0,
        likes: Number(likes) || 0,
        comments: Number(comments) || 0,
        shares: Number(shares) || 0,
        saves: Number(saves) || 0,
        metrics_note: metricsNote.trim() || null,
        tracking_mode:
          performanceItem?.tracking_mode === "api" ? "api" : "manual",
      };

      const result = await upsertTikTokPost(targetRunId, payload);
      onSuccess(result.run, result.post);
      onClose();
    } catch (err: any) {
      setErrorMessage(
        err.message || "Erro ao salvar publicação manual do TikTok"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={
        performanceItem?.provider === "zernio"
          ? "Editar métricas"
          : "Marcar como Publicado Manualmente"
      }
      subtitle={`Conta: @${targetAccountId}${
        targetArchetype ? ` • ${targetArchetype}` : ""
      }`}
      footer={
        <>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="manual-tiktok-form"
            variant="primary"
            isLoading={isSubmitting}
          >
            {isSubmitting ? "Salvando..." : "Salvar Publicação"}
          </Button>
        </>
      }
    >
      <form
        id="manual-tiktok-form"
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
      >
        {errorMessage && <InlineAlert tone="error">{errorMessage}</InlineAlert>}

        {performanceItem?.provider === "zernio" && (
          <InlineAlert tone="info">
            <span>
              Post rastreado pelo Zernio. As métricas são sincronizadas
              automaticamente; uma edição manual não remove o rastreamento.
            </span>
            {performanceItem.external_post_id && (
              <div className="mt-1 break-all font-mono text-[11px]">
                ID Zernio: {performanceItem.external_post_id}
              </div>
            )}
          </InlineAlert>
        )}

        {targetTema && (
          <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
            <span className="font-semibold text-slate-500">Tema:</span>
            <span className="text-slate-800">{targetTema}</span>
          </div>
        )}

        <Field
          label="URL da Publicação no TikTok"
          htmlFor="tiktok-video-url"
          hint="Link do vídeo publicado no TikTok (opcional, mas recomendado)."
        >
          <Input
            id="tiktok-video-url"
            type="url"
            placeholder="https://www.tiktok.com/@conta/video/..."
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            disabled={isSubmitting}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Data e Hora da Publicação"
            htmlFor="tiktok-published-at"
          >
            <Input
              id="tiktok-published-at"
              type="datetime-local"
              value={publishedAt}
              onChange={(e) => setPublishedAt(e.target.value)}
              disabled={isSubmitting}
            />
          </Field>
          <Field label="ID do Vídeo (Opcional)" htmlFor="tiktok-video-id">
            <Input
              id="tiktok-video-id"
              type="text"
              placeholder="Ex: 7391823901..."
              value={videoId}
              onChange={(e) => setVideoId(e.target.value)}
              disabled={isSubmitting}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Métricas Atuais
          </span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <MetricInput
              id="metric-views"
              label="Visualizações"
              value={views}
              onChange={setViews}
              disabled={isSubmitting}
            />
            <MetricInput
              id="metric-likes"
              label="Curtidas"
              value={likes}
              onChange={setLikes}
              disabled={isSubmitting}
            />
            <MetricInput
              id="metric-comments"
              label="Comentários"
              value={comments}
              onChange={setComments}
              disabled={isSubmitting}
            />
            <MetricInput
              id="metric-saves"
              label="Salvos"
              value={saves}
              onChange={setSaves}
              disabled={isSubmitting}
            />
            <MetricInput
              id="metric-shares"
              label="Compartilhamentos"
              value={shares}
              onChange={setShares}
              disabled={isSubmitting}
            />
          </div>
        </div>

        <Field label="Notas / Observações" htmlFor="tiktok-note">
          <Textarea
            id="tiktok-note"
            rows={2}
            placeholder="Ex: Teve alto engajamento nos primeiros 30 minutos..."
            value={metricsNote}
            onChange={(e) => setMetricsNote(e.target.value)}
            disabled={isSubmitting}
          />
        </Field>
      </form>
    </Modal>
  );
}
