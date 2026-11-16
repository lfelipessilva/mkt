import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount } from "../context";
import type { Account, CarouselRun, CarouselSlide } from "../types";
import { getCarouselRuns, generateCarousels, pollGenerationJob } from "../api";
import { RunCard } from "../components/RunCard";
import { ManualTikTokModal } from "../components/ManualTikTokModal";
import { RefreshCw, Search, Sparkles, X } from "lucide-react";

export function resolveGalleryTargetAccountIds(
  selectedAccountId: string,
  accounts: Account[]
): string[] {
  if (selectedAccountId && selectedAccountId !== "all") {
    return [selectedAccountId];
  }
  return accounts.filter((a) => a.enabled).map((a) => a.id);
}

export interface ExecuteGalleryGenerationOptions {
  selectedAccountId: string;
  accounts: Account[];
  onToast: (message: string, type: "success" | "error" | "info") => void;
  onRefresh: () => Promise<void> | void;
  generateFn?: (input: { accountIds?: string[] }) => Promise<any>;
  pollFn?: (jobId: string, options?: any) => Promise<any>;
}

export async function executeGalleryGeneration({
  selectedAccountId,
  accounts,
  onToast,
  onRefresh,
  generateFn = generateCarousels,
  pollFn = pollGenerationJob,
}: ExecuteGalleryGenerationOptions): Promise<boolean> {
  const targetAccountIds = resolveGalleryTargetAccountIds(selectedAccountId, accounts);
  if (targetAccountIds.length === 0) {
    onToast("Nenhuma conta ativa para gerar carrossel.", "info");
    return false;
  }

  onToast("Iniciando geração de carrossel...", "info");

  try {
    const job = await generateFn({ accountIds: targetAccountIds });
    const result = await pollFn(job.id, { intervalMs: 1500 });
    if (result && result.status === "failed") {
      throw new Error(result.error_message || "O job de geração finalizou com status de falha.");
    }
    onToast("Geração concluída com sucesso!", "success");
    await onRefresh();
    return true;
  } catch (err: any) {
    const message = err?.message || String(err);
    onToast(`Erro ao gerar carrossel: ${message}`, "error");
    return false;
  }
}

export function orderSlides(slides: CarouselSlide[]): CarouselSlide[] {
  return [...slides].sort((a, b) => a.position - b.position);
}

export function filterRunsByAccount(
  runs: CarouselRun[],
  selectedAccountId: string
): CarouselRun[] {
  if (!selectedAccountId || selectedAccountId === "all") {
    return runs;
  }
  return runs.filter((r) => r.account_id === selectedAccountId);
}

export function filterRunsByStatus(
  runs: CarouselRun[],
  status: string
): CarouselRun[] {
  if (!status || status === "all") {
    return runs;
  }
  return runs.filter((r) => r.status === status);
}

export function filterRunsBySearch(
  runs: CarouselRun[],
  searchQuery: string
): CarouselRun[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return runs;
  }
  return runs.filter((r) => {
    const archMatch = r.archetype_title?.toLowerCase().includes(query);
    const temaMatch = r.tema?.toLowerCase().includes(query);
    const baitMatch = r.bait_body?.toLowerCase().includes(query);
    const accMatch = r.account_id?.toLowerCase().includes(query);
    return Boolean(archMatch || temaMatch || baitMatch || accMatch);
  });
}

export function GalleryPage(): React.JSX.Element {
  const { selectedAccountId, selectedAccount, accounts } = useAccount();

  const [runs, setRuns] = useState<CarouselRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [activeModalRun, setActiveModalRun] = useState<CarouselRun | null>(null);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCarouselRuns({
        accountId: selectedAccountId !== "all" ? selectedAccountId : undefined,
      });
      setRuns(data);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar galeria de carrosséis");
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const handleOpenManualModal = (run: CarouselRun) => {
    setActiveModalRun(run);
    setModalOpen(true);
  };

  const handleRunUpdated = (updatedRun: CarouselRun) => {
    setRuns((prev) =>
      prev.map((r) => (r.id === updatedRun.id ? { ...r, ...updatedRun } : r))
    );
  };

  const handlePublishSuccess = (updatedRun: CarouselRun) => {
    handleRunUpdated(updatedRun);
    showToast(`Carrossel marcado como publicado no TikTok com sucesso!`, "success");
  };

  const handleGenerateCarousels = async () => {
    if (isGenerating || loading) return;

    const targetAccountIds = resolveGalleryTargetAccountIds(selectedAccountId, accounts);
    if (targetAccountIds.length === 0) {
      showToast("Nenhuma conta ativa para gerar carrossel.", "info");
      return;
    }

    setIsGenerating(true);
    try {
      await executeGalleryGeneration({
        selectedAccountId,
        accounts,
        onToast: showToast,
        onRefresh: loadRuns,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const filteredRuns = useMemo(() => {
    let list = filterRunsByAccount(runs, selectedAccountId);
    list = filterRunsByStatus(list, statusFilter);
    list = filterRunsBySearch(list, searchQuery);
    return list;
  }, [runs, selectedAccountId, statusFilter, searchQuery]);

  return (
    <div className="gallery-page" data-testid="gallery-page">
      {/* Toast Alert */}
      {toast && (
        <div className={`toast-alert toast-${toast.type}`} role="status">
          <span className="toast-message">{toast.message}</span>
          <button type="button" className="toast-close" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}

      {/* Top Header Card */}
      <div className="gallery-header-card">
        <div className="header-info">
          <h2>Galeria de Carrosséis</h2>
          <p className="page-desc">
            Visualize os carrosséis gerados com filmstrip completo de cada slide,
            despache diretamente para o Telegram e registre publicações manuais no TikTok.
          </p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn btn-primary flex items-center gap-1.5"
            onClick={handleGenerateCarousels}
            disabled={isGenerating || loading}
          >
            <Sparkles className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
            <span>
              {isGenerating
                ? "Gerando carrossel..."
                : selectedAccountId !== "all"
                ? `Gerar Carrossel (@${selectedAccount?.id ?? selectedAccountId})`
                : `Gerar para Todas as Contas`}
            </span>
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-refresh flex items-center gap-1.5"
            onClick={loadRuns}
            disabled={loading || isGenerating}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-blue-600" : ""}`} />
            <span>{loading ? "Carregando..." : "Atualizar"}</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="gallery-toolbar">
        <div className="status-tabs" role="tablist">
          {[
            { id: "all", label: "Todos" },
            { id: "generated", label: "Gerados" },
            { id: "dispatched", label: "Despachados" },
            { id: "published", label: "Publicados" },
            { id: "failed", label: "Com Falha" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={statusFilter === tab.id}
              className={`status-tab ${statusFilter === tab.id ? "active" : ""}`}
              onClick={() => setStatusFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="search-input-wrapper relative flex items-center">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
          <input
            type="text"
            className="search-input !pl-9"
            placeholder="Buscar por tema, arquétipo ou conta..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => setSearchQuery("")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Context info banner if pinned */}
      {selectedAccountId !== "all" && (
        <div className="context-filter-banner">
          <span>
            Exibindo carrosséis da conta <strong>@{selectedAccount?.id ?? selectedAccountId}</strong>
          </span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="error-card" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary" onClick={loadRuns}>
            Tentar novamente
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && runs.length === 0 && (
        <div className="loading-state">
          <span className="spinner-md" />
          <p>Carregando carrosséis...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredRuns.length === 0 && !error && (
        <div className="gallery-empty-state">
          <div className="empty-icon">🖼</div>
          <h3>Nenhum carrossel encontrado</h3>
          <p>
            {searchQuery || statusFilter !== "all"
              ? "Tente ajustar os filtros ou a busca acima."
              : "Clique em Gerar Carrossel acima para criar novos carrosséis."}
          </p>
          {!searchQuery && statusFilter === "all" && (
            <button
              type="button"
              className="btn btn-primary flex items-center gap-1.5"
              onClick={handleGenerateCarousels}
              disabled={isGenerating || loading}
            >
              <Sparkles className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
              <span>
                {isGenerating
                  ? "Gerando carrossel..."
                  : selectedAccountId !== "all"
                  ? `Gerar Carrossel (@${selectedAccount?.id ?? selectedAccountId})`
                  : `Gerar para Todas as Contas`}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Runs Grid */}
      <div className="runs-grid">
        {filteredRuns.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            onDispatched={handleRunUpdated}
            onOpenManualPublish={handleOpenManualModal}
            onRunUpdated={handleRunUpdated}
          />
        ))}
      </div>

      {/* Manual TikTok Modal */}
      <ManualTikTokModal
        isOpen={modalOpen}
        run={activeModalRun}
        onClose={() => {
          setModalOpen(false);
          setActiveModalRun(null);
        }}
        onSuccess={handlePublishSuccess}
      />
    </div>
  );
}
