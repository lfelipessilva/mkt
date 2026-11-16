import React, { useState, useEffect, useCallback } from "react";
import {
  getSettings,
  updateSetting,
  testDispatch,
  syncTikTok,
  getLatestTikTokSync,
  type TikTokSyncResult,
} from "../api";
import type { AppSettings, TikTokSyncRun } from "../types";
import { RefreshCw, Send, Zap } from "lucide-react";

export function IntegrationsPage(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({});
  const [latestSync, setLatestSync] = useState<TikTokSyncRun | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [testingDispatch, setTestingDispatch] = useState<boolean>(false);
  const [syncingTikTok, setSyncingTikTok] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [fetchedSettings, fetchedLatestSync] = await Promise.all([
        getSettings().catch((err) => {
          console.warn("Failed to load settings:", err);
          return {};
        }),
        getLatestTikTokSync().catch((err) => {
          console.warn("Failed to load latest sync:", err);
          return null;
        }),
      ]);
      setSettings(fetchedSettings);
      setLatestSync(fetchedLatestSync);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao carregar integrações"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleToggleAutoDispatch = async () => {
    const nextVal = !Boolean(settings.auto_dispatch_enabled);
    setSavingKey("auto_dispatch_enabled");
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await updateSetting("auto_dispatch_enabled", nextVal);
      setSettings((prev) => ({ ...prev, auto_dispatch_enabled: nextVal }));
      setStatusMessage(
        `Despacho automático ${nextVal ? "ativado" : "desativado"} com sucesso.`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao atualizar configuração"
      );
    } finally {
      setSavingKey(null);
    }
  };

  const handleTestDispatch = async () => {
    setTestingDispatch(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await testDispatch();
      setStatusMessage(
        res.message || "Disparo de teste executado com sucesso!"
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao disparar teste"
      );
    } finally {
      setTestingDispatch(false);
    }
  };

  const handleSyncTikTok = async () => {
    setSyncingTikTok(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res: TikTokSyncResult = await syncTikTok();
      setStatusMessage(
        `Sincronização TikTok concluída. Atualizados: ${res.posts_updated}, ignorados (manual): ${res.skipped_manual}.`
      );
      // Reload latest sync
      const latest = await getLatestTikTokSync();
      setLatestSync(latest);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao sincronizar TikTok"
      );
    } finally {
      setSyncingTikTok(false);
    }
  };

  return (
    <div className="integrations-page" data-testid="integrations-page">
      <div className="page-header-row">
        <div>
          <h3>Integrações & Despacho de Carrosséis</h3>
          <p className="page-subtitle">
            Configure as regras de envio automático, teste canais de despacho e sincronize métricas do TikTok.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline flex items-center gap-1.5"
          onClick={() => void loadData()}
          disabled={loading || Boolean(savingKey) || testingDispatch || syncingTikTok}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-blue-600" : ""}`} />
          <span>{loading ? "Atualizando..." : "Recarregar"}</span>
        </button>
      </div>

      {statusMessage && (
        <div className="banner banner-success" role="status">
          <span>✓ {statusMessage}</span>
          <button
            type="button"
            className="btn-icon"
            onClick={() => setStatusMessage(null)}
          >
            ×
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="banner banner-error" role="alert">
          <span>⚠ {errorMessage}</span>
          <button
            type="button"
            className="btn-icon"
            onClick={() => setErrorMessage(null)}
          >
            ×
          </button>
        </div>
      )}

      <div className="integrations-grid">
        {/* Card 1: Despacho Automático */}
        <div className="integration-card" data-testid="card-auto-dispatch">
          <div className="card-top">
            <div className="card-badge">Cron & Telegram</div>
            <h4>Despacho Automático (Cron)</h4>
            <p>
              Quando ativado, os carrosséis gerados pelas rotinas agendadas (CRON_SCHEDULE)
              são automaticamente encaminhados aos canais configurados (Telegram / Webhook).
            </p>
          </div>

          <div className="card-settings-group">
            <label className="toggle-switch-label">
              <input
                type="checkbox"
                checked={Boolean(settings.auto_dispatch_enabled)}
                disabled={Boolean(savingKey) || loading}
                onChange={() => void handleToggleAutoDispatch()}
                data-testid="toggle-auto-dispatch"
              />
              <span className="toggle-label-text">
                <strong>Habilitar despacho automático</strong>
                <span className="text-muted">
                  {settings.auto_dispatch_enabled
                    ? "Ativo (carrosséis são despachados sem confirmação manual)"
                    : "Desativado (carrosséis aguardam na Galeria para envio manual)"}
                </span>
              </span>
            </label>
          </div>

          <div className="card-actions">
            <button
              type="button"
              className="btn btn-outline flex items-center gap-1.5"
              onClick={() => void handleTestDispatch()}
              disabled={testingDispatch || loading}
              data-testid="btn-test-dispatch"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{testingDispatch ? "Disparando..." : "Testar Disparo de Canal"}</span>
            </button>
          </div>
        </div>

        {/* Card 2: TikTok Sync */}
        <div className="integration-card" data-testid="card-tiktok-sync">
          <div className="card-top">
            <div className="card-badge">TikTok API</div>
            <h4>Sincronização TikTok (Métricas)</h4>
            <p>
              Executa a rotina de atualização de métricas para posts publicados no TikTok.
              Posts rastreados no modo manual são preservados e não sofrem sobreposição.
            </p>
          </div>

          <div className="card-sync-status">
            <h5>Última Sincronização:</h5>
            {latestSync ? (
              <div className="sync-row" data-testid="sync-latest-row">
                <span className={`status-pill status-${latestSync.status}`}>
                  {latestSync.status}
                </span>
                <span className="sync-time">
                  Iniciado em: {new Date(latestSync.started_at).toLocaleString("pt-BR")}
                </span>
                {latestSync.finished_at && (
                  <span className="sync-finish">
                    Finalizado em: {new Date(latestSync.finished_at).toLocaleString("pt-BR")}
                  </span>
                )}
                <span className="sync-count">
                  {latestSync.posts_updated} post(s) atualizados
                </span>
              </div>
            ) : (
              <div className="sync-empty" data-testid="sync-empty-notice">
                Nenhuma sincronização registrada até o momento.
              </div>
            )}
          </div>

          <div className="card-actions">
            <button
              type="button"
              className="btn btn-primary flex items-center gap-1.5"
              onClick={() => void handleSyncTikTok()}
              disabled={syncingTikTok || loading}
              data-testid="btn-tiktok-sync"
            >
              <Zap className={`w-3.5 h-3.5 ${syncingTikTok ? "animate-pulse" : ""}`} />
              <span>{syncingTikTok ? "Sincronizando..." : "Sincronizar TikTok Agora"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
