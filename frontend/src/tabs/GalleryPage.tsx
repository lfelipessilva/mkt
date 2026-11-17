import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount } from "../context";
import type { Account, CarouselRun, CarouselSlide } from "../types";
import { getCarouselRuns, generateCarousels, pollGenerationJob } from "../api";
import { RunCard } from "../components/RunCard";
import { ManualTikTokModal } from "../components/ManualTikTokModal";
import { Images, RefreshCw, Search, Sparkles, X } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  InlineAlert,
  Input,
  LoadingState,
  PageHeader,
  Tabs,
  Toast,
  useToast,
} from "../ui";

export function resolveGalleryTargetAccountIds(
  selectedAccountId: string,
  accounts: Account[]
): string[] {
  if (selectedAccountId && selectedAccountId !== "all") {
    const match = accounts.find((a) => a.id === selectedAccountId);
    return match && match.enabled ? [match.id] : [];
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

    const total = result?.total ?? (result as any)?.result?.total ?? (result as any)?.job?.total ?? targetAccountIds.length;
    const completed = result?.completed ?? (result as any)?.result?.completed ?? (result as any)?.job?.completed ?? 0;
    const failed = result?.failed ?? (result as any)?.result?.failed ?? (result as any)?.job?.failed ?? 0;

    if (result && result.status === "failed") {
      const errMsg = result.error_message
        ? `Erro ao gerar carrossel: ${result.error_message}`
        : `Erro ao gerar carrossel: geração finalizada com falhas (${failed} falhas).`;
      onToast(errMsg, "error");
      return false;
    }

    if (failed > 0 && completed === 0) {
      const errMsg = result?.error_message
        ? `Erro ao gerar carrossel: ${result.error_message}`
        : `Erro ao gerar carrossel: geração finalizada com falhas (${failed} falhas).`;
      onToast(errMsg, "error");
      return false;
    }

    if (failed > 0 && completed > 0) {
      onToast(
        `Geração finalizada com avisos/falhas: ${completed}/${total} carrosséis gerados (${failed} falhas).`,
        "info"
      );
      await onRefresh();
      return true;
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

export function isRunInView(runs: CarouselRun[], runId?: string): boolean {
  if (!runId) return false;
  return runs.some((r) => r.id === runId);
}

export function checkFocusedRunVisibility(
  runs: CarouselRun[],
  focusedRunId?: string,
  loading: boolean = false
): { inView: boolean; showMissingBanner: boolean } {
  if (!focusedRunId) {
    return { inView: false, showMissingBanner: false };
  }
  const inView = isRunInView(runs, focusedRunId);
  const showMissingBanner = !loading && !inView;
  return { inView, showMissingBanner };
}

export interface GalleryPageProps {
  focusedRunId?: string;
}

export function GalleryPage({ focusedRunId }: GalleryPageProps = {}): React.JSX.Element {
  const { selectedAccountId, selectedAccount, accounts } = useAccount();

  const [runs, setRuns] = useState<CarouselRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [modalOpen, setModalOpen] = useState(false);
  const [activeModalRun, setActiveModalRun] = useState<CarouselRun | null>(null);

  const { toast, showToast, dismissToast } = useToast();

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
    showToast("Carrossel marcado como publicado no TikTok com sucesso!", "success");
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

  const accountsById = useMemo(() => {
    const map = new Map<string, Account>();
    for (const acc of accounts) {
      map.set(acc.id, acc);
    }
    return map;
  }, [accounts]);

  const filteredRuns = useMemo(() => {
    let list = filterRunsByAccount(runs, selectedAccountId);
    list = filterRunsByStatus(list, statusFilter);
    list = filterRunsBySearch(list, searchQuery);
    return list;
  }, [runs, selectedAccountId, statusFilter, searchQuery]);

  const { showMissingBanner } = checkFocusedRunVisibility(
    filteredRuns,
    focusedRunId,
    loading
  );

  useEffect(() => {
    if (!focusedRunId || loading) return;

    const el =
      document.getElementById(`run-card-${focusedRunId}`) ||
      document.querySelector(`[data-testid="run-card-${focusedRunId}"]`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusedRunId, loading, filteredRuns]);

  const generateLabel = isGenerating
    ? "Gerando carrossel..."
    : selectedAccountId !== "all"
    ? `Gerar Carrossel (@${selectedAccount?.id ?? selectedAccountId})`
    : "Gerar para Todas as Contas";

  const generateButton = (
    <Button
      variant="primary"
      onClick={handleGenerateCarousels}
      disabled={isGenerating || loading}
    >
      <Sparkles className={isGenerating ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
      <span>{generateLabel}</span>
    </Button>
  );

  return (
    <div className="flex flex-col gap-5" data-testid="gallery-page">
      <Toast toast={toast} onClose={dismissToast} />

      <PageHeader
        icon={<Images className="h-5 w-5" />}
        title="Galeria de Carrosséis"
        description="Visualize os carrosséis gerados com filmstrip completo de cada slide, despache diretamente para o Telegram e registre publicações manuais no TikTok."
        actions={
          <>
            {generateButton}
            <Button
              variant="secondary"
              onClick={loadRuns}
              disabled={loading || isGenerating}
            >
              <RefreshCw
                className={
                  loading ? "h-3.5 w-3.5 animate-spin text-blue-600" : "h-3.5 w-3.5"
                }
              />
              <span>{loading ? "Carregando..." : "Atualizar"}</span>
            </Button>
          </>
        }
      />

      <Card className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          ariaLabel="Filtrar por status"
          value={statusFilter}
          onChange={setStatusFilter}
          items={[
            { id: "all", label: "Todos" },
            { id: "generated", label: "Gerados" },
            { id: "dispatched", label: "Despachados" },
            { id: "published", label: "Publicados" },
            { id: "failed", label: "Com Falha" },
          ]}
        />

        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            className="pl-9 pr-9"
            placeholder="Buscar por tema, arquétipo ou conta..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              onClick={() => setSearchQuery("")}
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </Card>

      {selectedAccountId !== "all" && (
        <InlineAlert tone="info">
          Exibindo carrosséis da conta{" "}
          <strong>@{selectedAccount?.id ?? selectedAccountId}</strong>
        </InlineAlert>
      )}

      {showMissingBanner && (
        <InlineAlert
          tone="warning"
          role="alert"
          data-testid="focused-run-missing-banner"
        >
          Carrossel não encontrado nesta visualização
        </InlineAlert>
      )}

      {error && (
        <InlineAlert tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={loadRuns}>
              Tentar novamente
            </Button>
          </div>
        </InlineAlert>
      )}

      {loading && runs.length === 0 && (
        <LoadingState label="Carregando carrosséis..." />
      )}

      {!loading && filteredRuns.length === 0 && !error && (
        <EmptyState
          icon={<Images className="h-5 w-5" />}
          title="Nenhum carrossel encontrado"
          description={
            searchQuery || statusFilter !== "all"
              ? "Tente ajustar os filtros ou a busca acima."
              : "Clique em Gerar Carrossel acima para criar novos carrosséis."
          }
          action={
            !searchQuery && statusFilter === "all" ? generateButton : undefined
          }
        />
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {filteredRuns.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            account={accountsById.get(run.account_id)}
            metrics={
              (run as any).metrics ||
              ((run as any).views !== undefined
                ? {
                    views: (run as any).views,
                    likes: (run as any).likes,
                    comments: (run as any).comments,
                    shares: (run as any).shares,
                  }
                : undefined)
            }
            isFocused={Boolean(focusedRunId && run.id === focusedRunId)}
            onDispatched={handleRunUpdated}
            onOpenManualPublish={handleOpenManualModal}
            onRunUpdated={handleRunUpdated}
            onToast={showToast}
          />
        ))}
      </div>

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
