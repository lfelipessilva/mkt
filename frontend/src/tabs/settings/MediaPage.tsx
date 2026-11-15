import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount } from "../../context";
import {
  CONTENT_SCOPES,
  SCOPE_LABELS,
  MEDIA_CATEGORIES_FOR_SCOPE,
  resolveDefaultScope,
  type ContentScope,
  type MediaCategory,
  type MediaAsset,
} from "../../types";
import { getMedia, uploadMedia, deleteMedia } from "../../api";
import { AuthImage } from "../../components/AuthImage";

const CATEGORY_LABELS: Record<MediaCategory, string> = {
  capas: "Capas (Slide 1)",
  aleatorias: "Aleatórias (Slides 2-5)",
  listo: "Listo Brand (Final)",
};

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaPage(): React.JSX.Element {
  const { selectedAccountId, selectedAccount } = useAccount();

  // Step 4: Default scope opens pinned account role or "shared"
  const [activeScope, setActiveScope] = useState<ContentScope>(() =>
    resolveDefaultScope(selectedAccountId, selectedAccount)
  );

  // Sync active scope when pinned account changes
  useEffect(() => {
    setActiveScope(resolveDefaultScope(selectedAccountId, selectedAccount));
  }, [selectedAccountId, selectedAccount]);

  // Valid categories for current scope
  const validCategories = useMemo(() => {
    return MEDIA_CATEGORIES_FOR_SCOPE[activeScope] || [];
  }, [activeScope]);

  const [activeCategory, setActiveCategory] = useState<MediaCategory>(
    validCategories[0] || "aleatorias"
  );

  // Keep active category in sync if scope switches to one where current category is not allowed
  useEffect(() => {
    if (!validCategories.includes(activeCategory)) {
      setActiveCategory(validCategories[0] || "aleatorias");
    }
  }, [validCategories, activeCategory]);

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState<number>(0);

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const loadMedia = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const data = await getMedia({
        scope: activeScope,
        category: activeCategory,
      });
      setAssets(data);
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Erro ao carregar arquivos de mídia",
      });
    } finally {
      setLoading(false);
    }
  }, [activeScope, activeCategory]);

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setFeedback(null);
    try {
      const uploaded = await uploadMedia(selectedFile, activeScope, activeCategory);
      setAssets((prev) => [uploaded, ...prev.filter((a) => a.storage_path !== uploaded.storage_path)]);
      setSelectedFile(null);
      setFileInputKey((k) => k + 1);
      setFeedback({
        type: "success",
        message: `Arquivo "${uploaded.filename}" enviado com sucesso!`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Erro ao fazer upload da imagem",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (asset: MediaAsset) => {
    const confirm = window.confirm(
      `Deseja realmente excluir a mídia "${asset.filename}"?`
    );
    if (!confirm) return;

    setDeletingPath(asset.storage_path);
    setFeedback(null);
    try {
      await deleteMedia(asset.storage_path);
      setAssets((prev) => prev.filter((a) => a.storage_path !== asset.storage_path));
      setFeedback({
        type: "success",
        message: `Arquivo "${asset.filename}" excluído com sucesso!`,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Erro ao excluir arquivo de mídia",
      });
    } finally {
      setDeletingPath(null);
    }
  };

  return (
    <div className="settings-page media-page">
      <div className="page-section-header">
        <div>
          <h3>Biblioteca de Mídias</h3>
          <p className="section-description">
            Gerencie o repositório de fotos por escopo (geral ou específico de
            cada persona) e categoria de carrossel.
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`alert-banner ${
            feedback.type === "success" ? "alert-success" : "error-banner"
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            className="btn-icon"
            onClick={() => setFeedback(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Scope navigation tabs */}
      <div className="scope-tabs-container">
        <label className="scope-label">Escopo:</label>
        <div className="scope-tabs" role="tablist">
          {CONTENT_SCOPES.map((scope) => {
            const isActive = activeScope === scope;
            const isPinnedDefault =
              selectedAccountId !== "all" && selectedAccount?.role === scope;

            return (
              <button
                key={scope}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`scope-tab ${isActive ? "active" : ""}`}
                onClick={() => setActiveScope(scope)}
              >
                <span>{SCOPE_LABELS[scope]}</span>
                {isPinnedDefault && (
                  <span className="scope-pinned-tag" title="Role da conta em foco">
                    pinned
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Category sub-tabs */}
      <div className="category-subtabs-container">
        <label className="category-label">Categoria:</label>
        <div className="category-tabs" role="tablist">
          {validCategories.map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`category-pill ${isActive ? "active" : ""}`}
                onClick={() => setActiveCategory(cat)}
              >
                {CATEGORY_LABELS[cat] || cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Upload card */}
      <div className="upload-media-card">
        <form onSubmit={handleUpload} className="upload-media-form">
          <div className="upload-input-group">
            <label htmlFor="media-file-input" className="file-input-label">
              <span className="upload-icon">📁</span>
              <span>
                {selectedFile
                  ? selectedFile.name
                  : "Selecionar imagem do computador (JPG, PNG, WebP)"}
              </span>
            </label>
            <input
              key={fileInputKey}
              id="media-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden-file-input"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={!selectedFile || uploading}
          >
            {uploading ? "Enviando arquivo..." : "Fazer Upload"}
          </button>
        </form>
      </div>

      {/* Media Grid */}
      <div className="media-grid-section">
        <div className="media-grid-header">
          <h4>
            Mídias ({assets.length}) — {SCOPE_LABELS[activeScope]} /{" "}
            {CATEGORY_LABELS[activeCategory]}
          </h4>
        </div>

        {loading ? (
          <div className="loading-indicator">Carregando mídias...</div>
        ) : assets.length === 0 ? (
          <div className="empty-state">
            <p>Nenhuma mídia encontrada nesta categoria/escopo.</p>
            <span className="empty-sub">
              Faça upload de imagens acima para compor os carrosséis.
            </span>
          </div>
        ) : (
          <div className="media-grid">
            {assets.map((asset) => (
              <div key={asset.storage_path} className="media-card">
                <div className="media-preview-container">
                  <AuthImage
                    storagePath={asset.storage_path}
                    alt={asset.filename}
                    className="media-thumbnail"
                  />
                  <div className="media-card-badge">
                    {asset.width && asset.height
                      ? `${asset.width}×${asset.height}`
                      : asset.category}
                  </div>
                </div>

                <div className="media-card-details">
                  <span className="media-card-filename" title={asset.filename}>
                    {asset.filename}
                  </span>
                  <div className="media-card-meta">
                    <span className="media-size">
                      {formatBytes(asset.byte_size)}
                    </span>
                    <button
                      type="button"
                      className="btn-delete-media"
                      title="Excluir mídia"
                      disabled={deletingPath === asset.storage_path}
                      onClick={() => void handleDelete(asset)}
                    >
                      {deletingPath === asset.storage_path ? "..." : "Excluir"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
