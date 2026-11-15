import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount } from "../context";
import type {
  TikTokPerformanceItem,
  TikTokPerformanceSortField,
  CarouselRun,
  TikTokPost,
} from "../types";
import { getTikTokPerformance, syncTikTok } from "../api";
import { ManualTikTokModal } from "../components/ManualTikTokModal";

export function filterPerformanceByAccount(
  items: TikTokPerformanceItem[],
  selectedAccountId: string
): TikTokPerformanceItem[] {
  if (!selectedAccountId || selectedAccountId === "all") {
    return items;
  }
  return items.filter((item) => item.account_id === selectedAccountId);
}

export function sortPerformanceItems(
  items: TikTokPerformanceItem[],
  sortField: TikTokPerformanceSortField | string = "views",
  order: "asc" | "desc" = "desc"
): TikTokPerformanceItem[] {
  const sorted = [...items];
  const mult = order === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    if (
      sortField === "views" ||
      sortField === "likes" ||
      sortField === "comments" ||
      sortField === "shares"
    ) {
      const valA = Number((a as any)[sortField]) || 0;
      const valB = Number((b as any)[sortField]) || 0;
      return (valA - valB) * mult;
    }

    if (sortField === "published_at" || sortField === "created_at") {
      const dateA = (a as any)[sortField] ? new Date((a as any)[sortField]).getTime() : 0;
      const dateB = (b as any)[sortField] ? new Date((b as any)[sortField]).getTime() : 0;
      return (dateA - dateB) * mult;
    }

    return 0;
  });

  return sorted;
}

export interface PerformanceStats {
  totalPosts: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  avgViewsPerPost: number;
}

export function computePerformanceStats(items: TikTokPerformanceItem[]): PerformanceStats {
  if (!items || items.length === 0) {
    return {
      totalPosts: 0,
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      avgViewsPerPost: 0,
    };
  }

  const totalPosts = items.length;
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;

  for (const item of items) {
    totalViews += Number(item.views) || 0;
    totalLikes += Number(item.likes) || 0;
    totalComments += Number(item.comments) || 0;
    totalShares += Number(item.shares) || 0;
  }

  const avgViewsPerPost = Math.round(totalViews / totalPosts);

  return {
    totalPosts,
    totalViews,
    totalLikes,
    totalComments,
    totalShares,
    avgViewsPerPost,
  };
}

export function PerformancePage(): React.JSX.Element {
  const { selectedAccountId, selectedAccount } = useAccount();

  const [items, setItems] = useState<TikTokPerformanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sorting
  const [sortField, setSortField] = useState<TikTokPerformanceSortField>("views");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [activeItem, setActiveItem] = useState<TikTokPerformanceItem | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const loadPerformance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTikTokPerformance({
        accountId: selectedAccountId !== "all" ? selectedAccountId : undefined,
        sort: sortField,
        order: sortOrder,
      });
      setItems(data);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar dados de desempenho do TikTok");
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId, sortField, sortOrder]);

  useEffect(() => {
    loadPerformance();
  }, [loadPerformance]);

  const handleSyncTikTok = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await syncTikTok();
      showToast(
        `Sincronização TikTok concluída: ${result.posts_updated} atualizados, ${result.skipped_manual} manuais mantidos.`,
        "info"
      );
      await loadPerformance();
    } catch (err: any) {
      showToast(`Erro na sincronização: ${err.message || String(err)}`, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSortChange = (field: TikTokPerformanceSortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const handleOpenEditModal = (item: TikTokPerformanceItem) => {
    setActiveItem(item);
    setModalOpen(true);
  };

  const handleModalSuccess = (_run: CarouselRun, _post: TikTokPost) => {
    showToast("Métricas atualizadas com sucesso!", "success");
    loadPerformance();
  };

  const filteredItems = useMemo(() => {
    const contextFiltered = filterPerformanceByAccount(items, selectedAccountId);
    return sortPerformanceItems(contextFiltered, sortField, sortOrder);
  }, [items, selectedAccountId, sortField, sortOrder]);

  const stats = useMemo(() => computePerformanceStats(filteredItems), [filteredItems]);

  return (
    <div className="performance-page" data-testid="performance-page">
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
      <div className="performance-header-card">
        <div className="header-info">
          <h2>Desempenho de Carrosséis</h2>
          <p className="page-desc">
            Acompanhe métricas de engajamento do TikTok (visualizações, curtidas,
            comentários, compartilhamentos) dos carrosséis publicados.
          </p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSyncTikTok}
            disabled={isSyncing}
            title="Executar sincronização TikTok"
          >
            {isSyncing ? "Sincronizando..." : "⚡ Sincronizar TikTok"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-refresh"
            onClick={loadPerformance}
            disabled={loading}
          >
            {loading ? "Carregando..." : "↻ Atualizar"}
          </button>
        </div>
      </div>

      {/* Context banner */}
      {selectedAccountId !== "all" && (
        <div className="context-filter-banner">
          <span>
            Exibindo métricas da conta <strong>@{selectedAccount?.id ?? selectedAccountId}</strong>
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="metrics-summary-grid">
        <div className="kpi-card">
          <span className="kpi-label">Total Publicações</span>
          <span className="kpi-value">{stats.totalPosts}</span>
        </div>
        <div className="kpi-card highlight">
          <span className="kpi-label">Total de Views</span>
          <span className="kpi-value">{stats.totalViews.toLocaleString("pt-BR")}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Total de Curtidas</span>
          <span className="kpi-value">{stats.totalLikes.toLocaleString("pt-BR")}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Média Views / Post</span>
          <span className="kpi-value">{stats.avgViewsPerPost.toLocaleString("pt-BR")}</span>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="error-card" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary" onClick={loadPerformance}>
            Tentar novamente
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && items.length === 0 && (
        <div className="loading-state">
          <span className="spinner-md" />
          <p>Carregando métricas de desempenho...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredItems.length === 0 && !error && (
        <div className="performance-empty-state">
          <div className="empty-icon">📊</div>
          <h3>Nenhum dado de desempenho registrado</h3>
          <p>
            Vá até a aba <strong>Galeria</strong> e clique em{" "}
            <strong>"Publicado TikTok"</strong> em qualquer carrossel para registrar
            as métricas manuais.
          </p>
        </div>
      )}

      {/* Data Table */}
      {filteredItems.length > 0 && (
        <div className="table-wrapper">
          <table className="performance-table" aria-label="Tabela de Desempenho do TikTok">
            <thead>
              <tr>
                <th>Conta</th>
                <th>Carrossel / Tema</th>
                <th
                  className="sortable-th"
                  onClick={() => handleSortChange("published_at")}
                >
                  Data Publicação {sortField === "published_at" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                </th>
                <th
                  className="sortable-th number-cell"
                  onClick={() => handleSortChange("views")}
                >
                  Visualizações {sortField === "views" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                </th>
                <th
                  className="sortable-th number-cell"
                  onClick={() => handleSortChange("likes")}
                >
                  Curtidas {sortField === "likes" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                </th>
                <th
                  className="sortable-th number-cell"
                  onClick={() => handleSortChange("comments")}
                >
                  Comentários {sortField === "comments" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                </th>
                <th
                  className="sortable-th number-cell"
                  onClick={() => handleSortChange("shares")}
                >
                  Compartilhamentos {sortField === "shares" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                </th>
                <th>Modo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const pubDate = item.published_at
                  ? new Date(item.published_at).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })
                  : "—";

                return (
                  <tr key={item.id || item.tiktok_post_id}>
                    <td>
                      <span className="account-tag">@{item.account_id}</span>
                    </td>
                    <td>
                      <div className="perf-theme-cell">
                        <strong className="theme-title">
                          {item.tema || item.archetype_title}
                        </strong>
                        {item.tema && item.archetype_title && (
                          <span className="theme-sub">{item.archetype_title}</span>
                        )}
                      </div>
                    </td>
                    <td>{pubDate}</td>
                    <td className="number-cell font-mono font-bold">
                      {Number(item.views || 0).toLocaleString("pt-BR")}
                    </td>
                    <td className="number-cell font-mono">
                      {Number(item.likes || 0).toLocaleString("pt-BR")}
                    </td>
                    <td className="number-cell font-mono">
                      {Number(item.comments || 0).toLocaleString("pt-BR")}
                    </td>
                    <td className="number-cell font-mono">
                      {Number(item.shares || 0).toLocaleString("pt-BR")}
                    </td>
                    <td>
                      <span className={`tracking-mode-badge mode-${item.tracking_mode}`}>
                        {item.tracking_mode === "manual" ? "Manual" : "API"}
                      </span>
                    </td>
                    <td className="actions-cell">
                      <button
                        type="button"
                        className="btn-action edit"
                        onClick={() => handleOpenEditModal(item)}
                        title="Editar métricas"
                      >
                        Editar
                      </button>
                      {item.video_url && (
                        <a
                          href={item.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-action link"
                          title="Abrir no TikTok"
                        >
                          Ver ↗
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      <ManualTikTokModal
        isOpen={modalOpen}
        performanceItem={activeItem}
        onClose={() => {
          setModalOpen(false);
          setActiveItem(null);
        }}
        onSuccess={handleModalSuccess}
      />
    </div>
  );
}
