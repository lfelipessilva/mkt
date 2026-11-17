import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount } from "../context";
import type {
  TikTokPerformanceItem,
  TikTokPerformanceSortField,
  CarouselRun,
  TikTokPost,
  Account,
} from "../types";
import { getTikTokPerformance, syncTikTok } from "../api";
import { ManualTikTokModal } from "../components/ManualTikTokModal";
import { PerformanceChart } from "../components/PerformanceChart";
import { PerformanceCard, buildPerformanceRun } from "../components/PerformanceCard";
import { AuthImage } from "../components/AuthImage";
import { orderSlides } from "./GalleryPage";
import {
  RefreshCw,
  Zap,
  Eye,
  Heart,
  MessageSquare,
  Bookmark,
  Repeat2,
  BarChart3,
  Edit3,
  LayoutGrid,
  List,
  TrendingUp,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineAlert,
  LoadingState,
  PageHeader,
  Select,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  Toast,
  useToast,
} from "../ui";

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
      sortField === "shares" ||
      sortField === "saves"
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
  totalSaves: number;
  avgViewsPerPost: number;
  engagementRate: number;
}

export function computePerformanceStats(items: TikTokPerformanceItem[]): PerformanceStats {
  if (!items || items.length === 0) {
    return {
      totalPosts: 0,
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalSaves: 0,
      avgViewsPerPost: 0,
      engagementRate: 0,
    };
  }

  const totalPosts = items.length;
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalSaves = 0;

  for (const item of items) {
    totalViews += Number(item.views) || 0;
    totalLikes += Number(item.likes) || 0;
    totalComments += Number(item.comments) || 0;
    totalShares += Number(item.shares) || 0;
    totalSaves += Number(item.saves) || 0;
  }

  const avgViewsPerPost = Math.round(totalViews / totalPosts);
  const interactions = totalLikes + totalComments + totalShares + totalSaves;
  const engagementRate = totalViews > 0 ? (interactions / totalViews) * 100 : 0;

  return {
    totalPosts,
    totalViews,
    totalLikes,
    totalComments,
    totalShares,
    totalSaves,
    avgViewsPerPost,
    engagementRate,
  };
}

export function PerformancePage(): React.JSX.Element {
  const { selectedAccountId, selectedAccount, accounts } = useAccount();

  const [items, setItems] = useState<TikTokPerformanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

  const [sortField, setSortField] = useState<TikTokPerformanceSortField>("views");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [isSyncing, setIsSyncing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [activeItem, setActiveItem] = useState<TikTokPerformanceItem | null>(null);

  const { toast, showToast, dismissToast } = useToast();

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
      if (!result.ok) {
        const reason =
          result.errors?.[0]?.error || "erro desconhecido na sincronização";
        showToast(`Erro na sincronização: ${reason}`, "error");
        await loadPerformance();
        return;
      }
      showToast(
        result.status === "partial"
          ? `Sincronização parcial: ${result.posts_updated} atualizados, ${result.errors?.length ?? 0} falha(s).`
          : `Sincronização TikTok concluída: ${result.posts_updated} atualizados, ${result.skipped_manual} manuais mantidos.`,
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

  const accountsById = useMemo(() => {
    const map = new Map<string, Account>();
    for (const acc of accounts) {
      map.set(acc.id, acc);
    }
    return map;
  }, [accounts]);

  const filteredItems = useMemo(() => {
    const contextFiltered = filterPerformanceByAccount(items, selectedAccountId);
    return sortPerformanceItems(contextFiltered, sortField, sortOrder);
  }, [items, selectedAccountId, sortField, sortOrder]);

  const stats = useMemo(() => computePerformanceStats(filteredItems), [filteredItems]);

  const sortIndicator = (field: TikTokPerformanceSortField) =>
    sortField === field ? (
      <span className="ml-1 text-[10px] text-blue-600">
        {sortOrder === "asc" ? "▲" : "▼"}
      </span>
    ) : null;

  return (
    <div className="flex flex-col gap-5" data-testid="performance-page">
      <Toast toast={toast} onClose={dismissToast} />

      <PageHeader
        icon={<TrendingUp className="h-5 w-5" />}
        title="Desempenho de Carrosséis"
        description="Acompanhe todas as métricas do TikTok (views, curtidas, comentários, salvos e compartilhamentos) dos carrosséis publicados, com ranking de engajamento e cards completos."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={handleSyncTikTok}
              disabled={isSyncing}
              title="Executar sincronização TikTok"
            >
              <Zap
                className={
                  isSyncing
                    ? "h-3.5 w-3.5 animate-pulse"
                    : "h-3.5 w-3.5 text-amber-500"
                }
              />
              <span>{isSyncing ? "Sincronizando..." : "Sincronizar TikTok"}</span>
            </Button>
            <Button variant="secondary" onClick={loadPerformance} disabled={loading}>
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

      {selectedAccountId !== "all" && (
        <InlineAlert tone="info">
          Exibindo métricas da conta{" "}
          <strong>@{selectedAccount?.id ?? selectedAccountId}</strong>
        </InlineAlert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Publicações"
          value={stats.totalPosts}
          icon={<BarChart3 className="h-4 w-4" />}
          tone="slate"
          hint={`Média ${stats.avgViewsPerPost.toLocaleString("pt-BR")} views/post`}
        />
        <StatCard
          label="Views"
          value={stats.totalViews.toLocaleString("pt-BR")}
          icon={<Eye className="h-4 w-4" />}
          tone="blue"
          highlight
        />
        <StatCard
          label="Curtidas"
          value={stats.totalLikes.toLocaleString("pt-BR")}
          icon={<Heart className="h-4 w-4" />}
          tone="rose"
        />
        <StatCard
          label="Comentários"
          value={stats.totalComments.toLocaleString("pt-BR")}
          icon={<MessageSquare className="h-4 w-4" />}
          tone="emerald"
        />
        <StatCard
          label="Salvos"
          value={stats.totalSaves.toLocaleString("pt-BR")}
          icon={<Bookmark className="h-4 w-4" />}
          tone="slate"
        />
        <StatCard
          label="Compartilhamentos"
          value={stats.totalShares.toLocaleString("pt-BR")}
          icon={<Repeat2 className="h-4 w-4" />}
          tone="slate"
          hint={`Engajamento ${stats.engagementRate.toFixed(2)}%`}
        />
      </div>

      {filteredItems.length > 0 && <PerformanceChart items={filteredItems} />}

      {filteredItems.length > 0 && (
        <Card className="flex flex-col justify-between gap-3 p-3 sm:flex-row sm:items-center">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-slate-500">Ordenar por:</span>
            <Select
              className="w-auto py-1.5 text-xs"
              value={sortField}
              onChange={(e) => {
                setSortField(e.target.value as TikTokPerformanceSortField);
                setSortOrder("desc");
              }}
            >
              <option value="views">Visualizações</option>
              <option value="likes">Curtidas</option>
              <option value="comments">Comentários</option>
              <option value="shares">Compartilhamentos</option>
              <option value="saves">Salvos</option>
              <option value="published_at">Data de Publicação</option>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
              title={`Alternar ordem (atual: ${
                sortOrder === "asc" ? "crescente" : "decrescente"
              })`}
            >
              {sortOrder === "asc" ? "Crescente ↑" : "Decrescente ↓"}
            </Button>
          </div>

          <Tabs
            ariaLabel="Modo de visualização"
            value={viewMode}
            onChange={(id) => setViewMode(id as "cards" | "table")}
            items={[
              {
                id: "cards",
                label: (
                  <>
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Cards Ordenados
                  </>
                ),
              },
              {
                id: "table",
                label: (
                  <>
                    <List className="h-3.5 w-3.5" />
                    Tabela
                  </>
                ),
              },
            ]}
          />
        </Card>
      )}

      {error && (
        <InlineAlert tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={loadPerformance}>
              Tentar novamente
            </Button>
          </div>
        </InlineAlert>
      )}

      {loading && items.length === 0 && (
        <LoadingState label="Carregando métricas de desempenho..." />
      )}

      {!loading && filteredItems.length === 0 && !error && (
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" />}
          title="Nenhum dado de desempenho registrado"
          description={
            <>
              Vá até a aba <strong>Galeria</strong> e clique em{" "}
              <strong>"Publicado TikTok"</strong> em qualquer carrossel para
              registrar as métricas manuais.
            </>
          }
        />
      )}

      {filteredItems.length > 0 && viewMode === "cards" && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => (
            <PerformanceCard
              key={item.id || item.tiktok_post_id}
              item={item}
              account={accountsById.get(item.account_id)}
              onEdit={handleOpenEditModal}
            />
          ))}
        </div>
      )}

      {filteredItems.length > 0 && viewMode === "table" && (
        <Table aria-label="Tabela de Desempenho do TikTok">
          <TableHead>
            <TableRow className="hover:bg-transparent">
              <TableHeaderCell>Conta</TableHeaderCell>
              <TableHeaderCell>Carrossel / Tema</TableHeaderCell>
              <TableHeaderCell
                className="cursor-pointer select-none hover:text-slate-800"
                onClick={() => handleSortChange("published_at")}
              >
                Data Publicação
                {sortIndicator("published_at")}
              </TableHeaderCell>
              {(
                [
                  ["views", "Visualizações"],
                  ["likes", "Curtidas"],
                  ["comments", "Comentários"],
                  ["shares", "Compartilhamentos"],
                  ["saves", "Salvos"],
                ] as const
              ).map(([field, label]) => (
                <TableHeaderCell
                  key={field}
                  className="cursor-pointer select-none text-right hover:text-slate-800"
                  onClick={() => handleSortChange(field)}
                >
                  {label}
                  {sortIndicator(field)}
                </TableHeaderCell>
              ))}
              <TableHeaderCell>Zernio</TableHeaderCell>
              <TableHeaderCell>Modo</TableHeaderCell>
              <TableHeaderCell>Ações</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredItems.map((item) => {
              const pubDate = item.published_at
                ? new Date(item.published_at).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })
                : "—";

              return (
                <TableRow key={item.id || item.tiktok_post_id}>
                  <TableCell>
                    <span className="font-semibold text-blue-700">
                      @{item.account_id}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      {(() => {
                        const slides = orderSlides(
                          buildPerformanceRun(item).slides || []
                        );
                        const cover =
                          slides.find((slide) => slide.position === 1) ??
                          slides[0] ??
                          null;
                        return (
                          <div className="h-11 w-9 flex-none overflow-hidden rounded border border-slate-200 bg-slate-100">
                            {cover ? (
                              <AuthImage
                                storagePath={cover.storage_path}
                                alt={`Capa de ${item.tema || item.archetype_title}`}
                                className="h-full w-full object-cover"
                                fallbackText=""
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[9px] text-slate-400">
                                —
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <strong className="truncate font-semibold text-slate-800">
                          {item.tema || item.archetype_title}
                        </strong>
                        {item.tema && item.archetype_title && (
                          <span className="truncate text-[11px] text-slate-400">
                            {item.archetype_title}
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{pubDate}</TableCell>
                  <TableCell className="text-right font-mono font-bold text-slate-800">
                    {Number(item.views || 0).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(item.likes || 0).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(item.comments || 0).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(item.shares || 0).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(item.saves || 0).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    {item.external_post_id ? (
                      <div className="flex flex-col gap-0.5">
                        <code
                          className="break-all text-[11px] font-mono text-slate-600"
                          title={item.external_post_id}
                        >
                          {item.external_post_id}
                        </code>
                        <span className="text-[10px] uppercase tracking-wide text-slate-400">
                          {item.publish_status || "—"}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      tone={item.tracking_mode === "manual" ? "amber" : "blue"}
                      pill
                    >
                      {item.tracking_mode === "manual" ? "Manual" : "API"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="link"
                        size="sm"
                        className="text-xs"
                        onClick={() => handleOpenEditModal(item)}
                        title="Editar métricas"
                      >
                        <Edit3 className="h-3 w-3" />
                        <span>Editar</span>
                      </Button>
                      {item.video_url && (
                        <a
                          href={item.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                          title="Abrir no TikTok"
                        >
                          Ver ↗
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

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
