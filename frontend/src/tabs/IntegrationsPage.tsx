import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  getSettings,
  updateSetting,
  testDispatch,
  syncTikTok,
  getLatestTikTokSync,
  syncSocialAccounts,
  getAutomationSchedule,
  type TikTokSyncResult,
} from "../api";
import {
  formatScheduleStatus,
  formatScheduleChannel,
  formatPublicationStatus,
  type AppSettings,
  type TikTokSyncRun,
  type AutomationSchedule,
  type AutoPostSlot,
  type PostWindow,
} from "../types";
import {
  RefreshCw,
  Send,
  Zap,
  Plus,
  Trash2,
  AlertTriangle,
} from "lucide-react";

const DEFAULT_WINDOWS: PostWindow[] = [
  { id: "morning", start: "07:00", end: "09:00" },
  { id: "midday", start: "11:30", end: "12:30" },
  { id: "evening", start: "18:00", end: "20:00" },
];

export function IntegrationsPage(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({});
  const [latestSync, setLatestSync] = useState<TikTokSyncRun | null>(null);
  const [schedule, setSchedule] = useState<AutomationSchedule | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [scheduleLoading, setScheduleLoading] = useState<boolean>(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [testingDispatch, setTestingDispatch] = useState<boolean>(false);
  const [syncingTikTok, setSyncingTikTok] = useState<boolean>(false);
  const [syncingBuffer, setSyncingBuffer] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Settings editor states
  const [tzInput, setTzInput] = useState<string>("America/Sao_Paulo");
  const [countInput, setCountInput] = useState<number>(3);
  const [windowsInput, setWindowsInput] = useState<PostWindow[]>(DEFAULT_WINDOWS);

  const scheduleAbortRef = useRef<AbortController | null>(null);
  const scheduleRequestIdRef = useRef<number>(0);

  const loadSchedule = useCallback(async (date?: string) => {
    if (scheduleAbortRef.current) {
      scheduleAbortRef.current.abort();
    }
    const controller = new AbortController();
    scheduleAbortRef.current = controller;
    const requestId = ++scheduleRequestIdRef.current;

    setScheduleLoading(true);
    setScheduleError(null);
    try {
      const res = await getAutomationSchedule(date || undefined, controller.signal);
      if (requestId !== scheduleRequestIdRef.current) {
        return;
      }
      setSchedule(res);
      setScheduleDate((prev) => (prev ? prev : res.date || ""));
    } catch (err) {
      if (
        controller.signal.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      if (requestId !== scheduleRequestIdRef.current) {
        return;
      }
      console.warn("Failed to load schedule:", err);
      setSchedule(null);
      setScheduleError(
        err instanceof Error
          ? err.message
          : "Erro ao carregar a agenda de postagens"
      );
    } finally {
      if (requestId === scheduleRequestIdRef.current) {
        setScheduleLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (scheduleAbortRef.current) {
        scheduleAbortRef.current.abort();
      }
    };
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [fetchedSettings, fetchedLatestSync] = await Promise.all([
        getSettings().catch((err) => {
          console.warn("Failed to load settings:", err);
          return {} as AppSettings;
        }),
        getLatestTikTokSync().catch((err) => {
          console.warn("Failed to load latest sync:", err);
          return null;
        }),
      ]);

      setSettings(fetchedSettings);
      setLatestSync(fetchedLatestSync);

      if (fetchedSettings.auto_post_timezone) {
        setTzInput(String(fetchedSettings.auto_post_timezone));
      }
      if (fetchedSettings.auto_post_count_per_day !== undefined) {
        setCountInput(Number(fetchedSettings.auto_post_count_per_day));
      }
      if (fetchedSettings.auto_post_windows) {
        try {
          const parsed =
            typeof fetchedSettings.auto_post_windows === "string"
              ? JSON.parse(fetchedSettings.auto_post_windows)
              : fetchedSettings.auto_post_windows;
          if (Array.isArray(parsed) && parsed.length > 0) {
            setWindowsInput(parsed);
          }
        } catch {
          // ignore parsing error, keep default
        }
      }
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
    void loadSchedule();
  }, [loadData, loadSchedule]);

  // Recarrega a cada 60s enquanto a página estiver montada
  useEffect(() => {
    const interval = setInterval(() => {
      void loadSchedule(scheduleDate || undefined);
    }, 60000);
    return () => clearInterval(interval);
  }, [loadSchedule, scheduleDate]);

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
      // Reload schedule to reflect new state
      void loadSchedule(scheduleDate || undefined);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao atualizar configuração"
      );
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveTimezone = async () => {
    setSavingKey("auto_post_timezone");
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await updateSetting("auto_post_timezone", tzInput.trim());
      setSettings((prev) => ({ ...prev, auto_post_timezone: tzInput.trim() }));
      setStatusMessage(`Fuso horário salvo: ${tzInput.trim()}`);
      void loadSchedule(scheduleDate || undefined);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao salvar fuso horário"
      );
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveCount = async () => {
    setSavingKey("auto_post_count_per_day");
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const val = Math.min(Math.max(Number(countInput) || 3, 1), 6);
      await updateSetting("auto_post_count_per_day", val);
      setSettings((prev) => ({ ...prev, auto_post_count_per_day: val }));
      setStatusMessage(`Qtd. de posts/janelas por dia salva: ${val}`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao salvar quantidade de posts"
      );
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveWindows = async () => {
    setSavingKey("auto_post_windows");
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await updateSetting("auto_post_windows", windowsInput);
      setSettings((prev) => ({ ...prev, auto_post_windows: windowsInput }));
      setStatusMessage("Janelas de postagem salvas com sucesso!");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao salvar janelas de postagem"
      );
    } finally {
      setSavingKey(null);
    }
  };

  const handleWindowChange = (
    index: number,
    field: keyof PostWindow,
    value: string
  ) => {
    setWindowsInput((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleAddWindow = () => {
    setWindowsInput((prev) => [
      ...prev,
      { id: `custom_${prev.length + 1}`, start: "14:00", end: "16:00" },
    ]);
  };

  const handleRemoveWindow = (index: number) => {
    setWindowsInput((prev) => prev.filter((_, i) => i !== index));
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

  const handleSyncBuffer = async () => {
    setSyncingBuffer(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await syncSocialAccounts();
      setStatusMessage(
        `Sincronização Buffer concluída: ${res.synced} canal(is) encontrado(s), ${res.matched} vinculado(s), ${res.created} importado(s).`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao sincronizar Buffer"
      );
    } finally {
      setSyncingBuffer(false);
    }
  };

  const formatSlotTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: schedule?.timezone || settings.auto_post_timezone || "America/Sao_Paulo",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="integrations-page" data-testid="integrations-page">
      <div className="page-header-row">
        <div>
          <h3>Integrações & Despacho de Carrosséis</h3>
          <p className="page-subtitle">
            Configure as regras de envio automático, teste canais de despacho e acompanhe a agenda diária de publicações.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline flex items-center gap-1.5"
          onClick={() => {
            void loadData();
            void loadSchedule(scheduleDate || undefined);
          }}
          disabled={loading || scheduleLoading || Boolean(savingKey) || testingDispatch || syncingTikTok}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading || scheduleLoading ? "animate-spin text-blue-600" : ""}`} />
          <span>{loading || scheduleLoading ? "Atualizando..." : "Recarregar"}</span>
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
        {/* Card 1: Despacho Automático (Spec §5.9.4 copy) */}
        <div className="integration-card" data-testid="card-auto-dispatch">
          <div className="card-top">
            <div className="card-badge">Cron & Publicação Automática</div>
            <h4>Despacho Automático (Rotina Diária)</h4>
            <p>
              Quando ativado, a rotina gera 3 carrosséis por conta por dia em horários sorteados (7h–9h, 11h30–12h30, 18h–20h), uma conta por vez, e publica no Buffer (contas vinculadas) ou no Telegram (demais).
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
                <strong>Habilitar rotina de despacho automático</strong>
                <span className="text-muted">
                  {settings.auto_dispatch_enabled
                    ? "Ativo (carrosséis são gerados e despachados conforme os slots diários)"
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

        {/* Card 3: Buffer Social Publishing */}
        <div className="integration-card" data-testid="card-buffer-sync">
          <div className="card-top">
            <div className="card-badge">Buffer API</div>
            <h4>Buffer Social Publishing</h4>
            <p>
              Sincroniza canais do TikTok conectados ao Buffer e permite despacho direto de carrosséis.
            </p>
          </div>

          <div className="card-sync-status">
            <p className="text-muted text-sm">
              Ao puxar as contas, os canais conectados no Buffer serão vinculados às personas existentes
              ou importados automaticamente como novas contas.
            </p>
          </div>

          <div className="card-actions">
            <button
              type="button"
              className="btn btn-primary flex items-center gap-1.5"
              onClick={() => void handleSyncBuffer()}
              disabled={syncingBuffer || loading}
              data-testid="btn-buffer-sync"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingBuffer ? "animate-spin" : ""}`} />
              <span>{syncingBuffer ? "Puxando contas..." : "Puxar Contas do Buffer"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Full-width Card: Configurações da Rotina Diária (Windows, Count, Timezone) */}
      <div
        className="integration-card mt-6"
        data-testid="card-routine-settings"
        style={{ marginTop: "24px", width: "100%" }}
      >
        <div className="card-top">
          <div className="card-badge">Configuração de Rotina</div>
          <h4>Parâmetros da Agenda Automática</h4>
          <p>
            Ajuste o fuso horário de referência, a quantidade diária de publicações por conta e as janelas de sorteio dos horários.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
          {/* Editor: Fuso Horário */}
          <div className="card-settings-group flex flex-col justify-between">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1" htmlFor="input-timezone">
                Fuso Horário (Timezone)
              </label>
              <p className="text-xs text-muted mb-2">
                Utilizado para sorteio e verificação das janelas locais.
              </p>
              <input
                id="input-timezone"
                type="text"
                className="w-full text-sm p-2 border border-slate-300 rounded"
                value={tzInput}
                onChange={(e) => setTzInput(e.target.value)}
                placeholder="America/Sao_Paulo"
                data-testid="input-timezone"
              />
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm mt-3 self-end"
              onClick={() => void handleSaveTimezone()}
              disabled={Boolean(savingKey) || loading}
              data-testid="btn-save-timezone"
            >
              {savingKey === "auto_post_timezone" ? "Salvando..." : "Salvar Fuso"}
            </button>
          </div>

          {/* Editor: Quantidade de Carrosséis por Dia */}
          <div className="card-settings-group flex flex-col justify-between">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1" htmlFor="input-count">
                Posts por Dia por Conta (1 a 6)
              </label>
              <p className="text-xs text-muted mb-2">
                Número de janelas/slots gerados por conta em cada dia.
              </p>
              <input
                id="input-count"
                type="number"
                min={1}
                max={6}
                className="w-full text-sm p-2 border border-slate-300 rounded"
                value={countInput}
                onChange={(e) => setCountInput(parseInt(e.target.value, 10) || 1)}
                data-testid="input-count-per-day"
              />
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm mt-3 self-end"
              onClick={() => void handleSaveCount()}
              disabled={Boolean(savingKey) || loading}
              data-testid="btn-save-count"
            >
              {savingKey === "auto_post_count_per_day" ? "Salvando..." : "Salvar Quantidade"}
            </button>
          </div>

          {/* Editor: Janelas de Postagem */}
          <div className="card-settings-group flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-semibold text-slate-800">
                  Janelas de Horário
                </label>
                <button
                  type="button"
                  className="btn btn-outline btn-xs flex items-center gap-1 text-xs px-2 py-0.5"
                  onClick={handleAddWindow}
                  title="Adicionar nova janela"
                >
                  <Plus className="w-3 h-3" />
                  <span>Adicionar</span>
                </button>
              </div>
              <p className="text-xs text-muted mb-2">
                Intervalos de horas (HH:mm) para agendamento dos posts.
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {windowsInput.map((win, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 text-xs mb-1.5">
                    <input
                      type="text"
                      className="w-20 p-1 border rounded text-xs"
                      value={win.id}
                      placeholder="id"
                      onChange={(e) => handleWindowChange(idx, "id", e.target.value)}
                    />
                    <input
                      type="text"
                      className="w-16 p-1 border rounded text-xs"
                      value={win.start}
                      placeholder="07:00"
                      onChange={(e) => handleWindowChange(idx, "start", e.target.value)}
                    />
                    <span>–</span>
                    <input
                      type="text"
                      className="w-16 p-1 border rounded text-xs"
                      value={win.end}
                      placeholder="09:00"
                      onChange={(e) => handleWindowChange(idx, "end", e.target.value)}
                    />
                    {windowsInput.length > 1 && (
                      <button
                        type="button"
                        className="btn-icon text-red-500 hover:text-red-700 ml-1"
                        onClick={() => handleRemoveWindow(idx)}
                        title="Remover janela"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm mt-3 self-end"
              onClick={() => void handleSaveWindows()}
              disabled={Boolean(savingKey) || loading}
              data-testid="btn-save-windows"
            >
              {savingKey === "auto_post_windows" ? "Salvando..." : "Salvar Janelas"}
            </button>
          </div>
        </div>
      </div>

      {/* Full-width Card: Painel "Agenda de hoje" (Spec §5.9.2) */}
      <div
        className="integration-card full-width-card mt-6"
        data-testid="card-agenda-panel"
        style={{ marginTop: "24px", width: "100%" }}
      >
        <div className="card-top flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="card-badge">Planejamento Diário</div>
            <h4>Agenda de Postagens ({schedule?.date || "Hoje"})</h4>
            <p className="text-xs text-muted">
              Fuso Horário: <strong>{schedule?.timezone || settings.auto_post_timezone || "America/Sao_Paulo"}</strong> | Estado da rotina:{" "}
              <strong className={schedule?.enabled || settings.auto_dispatch_enabled ? "text-emerald-700" : "text-amber-700"}>
                {schedule?.enabled || settings.auto_dispatch_enabled ? "Ativo" : "Desativado"}
              </strong>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              className="text-sm border border-slate-300 rounded px-2.5 py-1"
              value={scheduleDate}
              onChange={(e) => {
                setScheduleDate(e.target.value);
                void loadSchedule(e.target.value);
              }}
              data-testid="input-agenda-date"
            />
            <button
              type="button"
              className="btn btn-outline btn-sm flex items-center gap-1.5"
              onClick={() => void loadSchedule(scheduleDate || undefined)}
              disabled={scheduleLoading}
              data-testid="btn-reload-agenda"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scheduleLoading ? "animate-spin text-blue-600" : ""}`} />
              <span>{scheduleLoading ? "Atualizando..." : "Recarregar Agenda"}</span>
            </button>
          </div>
        </div>

        {scheduleError && (
          <div
            className="banner banner-error"
            role="alert"
            data-testid="agenda-error-banner"
            style={{ marginTop: "16px" }}
          >
            <span>⚠ {scheduleError}</span>
          </div>
        )}

        {/* Tabela de slots da agenda */}
        <div className="accounts-table-wrapper" style={{ marginTop: "16px", overflowX: "auto" }}>
          <table className="data-table" data-testid="agenda-table">
            <thead>
              <tr>
                <th>Horário</th>
                <th>Conta</th>
                <th>Canal</th>
                <th>Status da Execução</th>
                <th>Desfecho da Publicação</th>
                <th>Erro / Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {scheduleError ? (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-red-600 font-medium" data-testid="agenda-error-row">
                    ⚠ {scheduleError}
                  </td>
                </tr>
              ) : !schedule || schedule.slots.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-muted italic" data-testid="agenda-empty-row">
                    Nenhum slot agendado para esta data.
                  </td>
                </tr>
              ) : (
                schedule.slots.map((slot: AutoPostSlot) => {
                  return (
                    <tr
                      key={slot.id}
                      className={!slot.account_enabled ? "row-disabled" : ""}
                      data-testid="agenda-slot-row"
                    >
                      <td>
                        <strong className="text-slate-800">{formatSlotTime(slot.scheduled_at)}</strong>
                        <div className="text-xs text-muted" title={slot.scheduled_at}>
                          Janela: {slot.window_id}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-900">
                            {slot.account_display_name || slot.account_id}
                          </span>
                          {!slot.account_enabled && (
                            <span
                              className="badge-disabled text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200"
                              title="Conta desabilitada"
                              data-testid="account-disabled-badge"
                            >
                              <AlertTriangle className="w-3 h-3 inline mr-0.5" />
                              Desativada
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted">@{slot.account_id}</div>
                      </td>
                      <td>
                        <span className="role-badge role-shared">
                          {formatScheduleChannel(slot.channel)}
                        </span>
                      </td>
                      <td>
                        <span className={`status-pill status-${slot.status}`} data-testid={`slot-status-${slot.id}`}>
                          {formatScheduleStatus(slot.status)}
                        </span>
                      </td>
                      <td>
                        <span className="text-sm font-medium">
                          {formatPublicationStatus(slot.post_status)}
                        </span>
                      </td>
                      <td>
                        {slot.last_error ? (
                          <span className="text-xs text-red-600 font-mono" title={slot.last_error}>
                            {slot.last_error}
                          </span>
                        ) : (
                          <span className="text-muted text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
