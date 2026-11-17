import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount } from "../../context";
import {
  MEDIA_SCOPES,
  MEDIA_SCOPE_LABELS,
  MEDIA_CATEGORIES_FOR_SCOPE,
  resolveDefaultScope,
  type MediaScope,
  type MediaCategory,
  type MediaAsset,
} from "../../types";
import { getMedia, uploadMedia, deleteMedia } from "../../api";
import { AuthImage } from "../../components/AuthImage";
import { FolderArchive, Trash2, UploadCloud } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  InlineAlert,
  LoadingState,
  PageHeader,
  ScopeTabs,
  Tabs,
} from "../../ui";

const CATEGORY_LABELS: Record<MediaCategory, string> = {
  cover: "Cover (Slide 1)",
  random: "Random (Slides 2-5)",
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

  const [activeScope, setActiveScope] = useState<MediaScope>(() =>
    resolveDefaultScope(selectedAccountId, selectedAccount)
  );

  useEffect(() => {
    setActiveScope(resolveDefaultScope(selectedAccountId, selectedAccount));
  }, [selectedAccountId, selectedAccount]);

  const validCategories = useMemo(() => {
    return MEDIA_CATEGORIES_FOR_SCOPE[activeScope] || [];
  }, [activeScope]);

  const [activeCategory, setActiveCategory] = useState<MediaCategory>(
    validCategories[0] || "random"
  );

  useEffect(() => {
    if (!validCategories.includes(activeCategory)) {
      setActiveCategory(validCategories[0] || "random");
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
      setAssets((prev) => [
        uploaded,
        ...prev.filter((a) => a.storage_path !== uploaded.storage_path),
      ]);
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
      setAssets((prev) =>
        prev.filter((a) => a.storage_path !== asset.storage_path)
      );
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
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={<FolderArchive className="h-5 w-5" />}
        title="Biblioteca de Mídias"
        description="Gerencie o repositório de fotos por escopo (geral ou específico de cada persona) e categoria de carrossel."
      />

      {feedback && (
        <InlineAlert
          tone={feedback.type === "success" ? "success" : "error"}
          onClose={() => setFeedback(null)}
        >
          {feedback.message}
        </InlineAlert>
      )}

      <ScopeTabs
        label="Escopo"
        ariaLabel="Escopo de mídia"
        options={MEDIA_SCOPES.map((scope) => ({
          id: scope,
          label: MEDIA_SCOPE_LABELS[scope],
          pinned: selectedAccountId !== "all" && selectedAccount?.role === scope,
        }))}
        value={activeScope}
        onChange={(id) => setActiveScope(id as MediaScope)}
      />

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:gap-4">
        <span className="flex-none text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Categoria
        </span>
        <Tabs
          variant="pills"
          ariaLabel="Categoria de mídia"
          value={activeCategory}
          onChange={(id) => setActiveCategory(id as MediaCategory)}
          items={validCategories.map((cat) => ({
            id: cat,
            label: CATEGORY_LABELS[cat] || cat,
          }))}
        />
      </div>

      <Card className="border-dashed p-4">
        <form
          onSubmit={handleUpload}
          className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center"
        >
          <div className="min-w-0 flex-1">
            <label
              htmlFor="media-file-input"
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-600 transition-colors hover:border-blue-400 hover:bg-blue-50/50 hover:text-slate-900"
            >
              <UploadCloud className="h-4 w-4 flex-none text-blue-600" />
              <span className="truncate">
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
              className="hidden"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={!selectedFile || uploading}
            isLoading={uploading}
          >
            {uploading ? "Enviando arquivo..." : "Fazer Upload"}
          </Button>
        </form>
      </Card>

      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-slate-900">
            Mídias ({assets.length})
          </h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {MEDIA_SCOPE_LABELS[activeScope]} / {CATEGORY_LABELS[activeCategory]}
          </p>
        </div>

        {loading ? (
          <LoadingState label="Carregando mídias..." />
        ) : assets.length === 0 ? (
          <EmptyState
            icon={<FolderArchive className="h-5 w-5" />}
            title="Nenhuma mídia encontrada"
            description="Faça upload de imagens acima para compor os carrosséis."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {assets.map((asset) => (
              <div
                key={asset.storage_path}
                className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
              >
                <div className="relative aspect-[4/5] w-full overflow-hidden bg-slate-100">
                  <AuthImage
                    storagePath={asset.storage_path}
                    alt={asset.filename}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute right-1.5 top-1.5 rounded-md bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                    {asset.width && asset.height
                      ? `${asset.width}×${asset.height}`
                      : asset.category}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5 p-2.5">
                  <span
                    className="truncate text-xs font-medium text-slate-700"
                    title={asset.filename}
                  >
                    {asset.filename}
                  </span>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{formatBytes(asset.byte_size)}</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      title="Excluir mídia"
                      disabled={deletingPath === asset.storage_path}
                      onClick={() => void handleDelete(asset)}
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>
                        {deletingPath === asset.storage_path ? "..." : "Excluir"}
                      </span>
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
