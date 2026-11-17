import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  getSettings,
  updateSetting,
  testDispatch,
  syncTikTok,
  getLatestTikTokSync,
  syncSocialAccounts,
  getTikTokConnectUrl,
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
  Cpu,
  CalendarDays,
  SlidersHorizontal,
} from "lucide-react";
import {
  Badge,
  Button,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  SectionCard,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui";

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
  const [connectingTikTok, setConnectingTikTok] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
          // keep defaults when persisted windows are malformed
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
      setStatusMessage(res.message || "Disparo de teste executado com sucesso!");
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

  const handleConnectTikTok = async () => {
    setConnectingTikTok(true);
    setErrorMessage(null);
    try {
      const { authUrl } = await getTikTokConnectUrl();
      window.open(authUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erro ao conectar TikTok");
    } finally {
      setConnectingTikTok(false);
    }
  };

  const handleSyncBuffer = async () => {
    setSyncingBuffer(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await syncSocialAccounts();
      setStatusMessage(
        `Sincronização Zernio concluída: ${res.synced} canal(is) encontrado(s), ${res.matched} vinculado(s), ${res.created} importado(s).`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao sincronizar Zernio"
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
        timeZone:
          schedule?.timezone ||
          settings.auto_post_timezone ||
          "America/Sao_Paulo",
      });
    } catch {
      return isoString;
    }
  };

  const routineActive = Boolean(
    schedule?.enabled || settings.auto_dispatch_enabled
  );

  return (
    <div className="flex flex-col gap-5" data-testid="integrations-page">
      <PageHeader
        icon={<Cpu className="h-5 w-5" />}
        title="Integrações & Despacho de Carrosséis"
        description="Configure as regras de envio automático, teste canais de despacho e acompanhe a agenda diária de publicações."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void loadData();
              void loadSchedule(scheduleDate || undefined);
            }}
            disabled={
              loading ||
              scheduleLoading ||
              Boolean(savingKey) ||
              testingDispatch ||
              syncingTikTok
            }
          >
            <RefreshCw
              className={
                loading || scheduleLoading
                  ? "h-3.5 w-3.5 animate-spin text-blue-600"
                  : "h-3.5 w-3.5"
              }
            />
            <span>
              {loading || scheduleLoading ? "Atualizando..." : "Recarregar"}
            </span>
          </Button>
        }
      />

      {statusMessage && (
        <InlineAlert tone="success" onClose={() => setStatusMessage(null)}>
          {statusMessage}
        </InlineAlert>
      )}

      {errorMessage && (
        <InlineAlert tone="error" onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </InlineAlert>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <SectionCard
          title="Despacho Automático (Rotina Diária)"
          description="Quando ativado, a rotina gera 3 carrosséis por conta por dia em horários sorteados (7h–9h, 11h30–12h30, 18h–20h), uma conta por vez, e publica no Buffer (contas vinculadas) ou no Telegram (demais)."
          icon={<Zap className="h-4 w-4" />}
          actions={
            <Badge tone="blue">Cron & Publicação</Badge>
          }
          data-testid="card-auto-dispatch"
        >
          <div className="flex flex-col gap-4">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 flex-none rounded border-slate-300 accent-blue-600"
                checked={Boolean(settings.auto_dispatch_enabled)}
                disabled={Boolean(savingKey) || loading}
                onChange={() => void handleToggleAutoDispatch()}
                data-testid="toggle-auto-dispatch"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800">
                  Habilitar rotina de despacho automático
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {settings.auto_dispatch_enabled
                    ? "Ativo (carrosséis são gerados e despachados conforme os slots diários)"
                    : "Desativado (carrosséis aguardam na Galeria para envio manual)"}
                </span>
              </span>
            </label>

            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleTestDispatch()}
                disabled={testingDispatch || loading}
                isLoading={testingDispatch}
                data-testid="btn-test-dispatch"
              >
                {!testingDispatch && <Send className="h-3.5 w-3.5" />}
                <span>
                  {testingDispatch ? "Disparando..." : "Testar Disparo de Canal"}
                </span>
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Sincronização TikTok (Métricas)"
          description="Executa a rotina de atualização de métricas para posts publicados no TikTok. Posts rastreados no modo manual são preservados e não sofrem sobreposição."
          icon={<RefreshCw className="h-4 w-4" />}
          actions={<Badge tone="pink">TikTok API</Badge>}
          data-testid="card-tiktok-sync"
        >
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Última Sincronização
              </h4>
              {latestSync ? (
                <div className="flex flex-col gap-1.5 text-xs" data-testid="sync-latest-row">
                  <StatusBadge status={latestSync.status} />
                  <span className="text-slate-500">
                    Iniciado em: {new Date(latestSync.started_at).toLocaleString("pt-BR")}
                  </span>
                  {latestSync.finished_at && (
                    <span className="text-slate-500">
                      Finalizado em: {new Date(latestSync.finished_at).toLocaleString("pt-BR")}
                    </span>
                  )}
                  <span className="font-semibold text-emerald-700">
                    {latestSync.posts_updated} post(s) atualizados
                  </span>
                </div>
              ) : (
                <div
                  className="text-xs italic text-slate-400"
                  data-testid="sync-empty-notice"
                >
                  Nenhuma sincronização registrada até o momento.
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleSyncTikTok()}
                disabled={syncingTikTok || loading}
                isLoading={syncingTikTok}
                data-testid="btn-tiktok-sync"
              >
                {!syncingTikTok && <Zap className="h-3.5 w-3.5" />}
                <span>
                  {syncingTikTok ? "Sincronizando..." : "Sincronizar TikTok Agora"}
                </span>
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Zernio"
          description="Conecta o TikTok, puxa as contas e publica o carrossel com áudio."
          icon={<RefreshCw className="h-4 w-4" />}
          actions={<Badge tone="purple">Zernio</Badge>}
          data-testid="card-buffer-sync"
        >
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleConnectTikTok()}
              disabled={connectingTikTok || loading}
            >
              {connectingTikTok ? "Abrindo..." : "Conectar TikTok"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSyncBuffer()}
              disabled={syncingBuffer || loading}
              isLoading={syncingBuffer}
              data-testid="btn-buffer-sync"
            >
              {!syncingBuffer && <RefreshCw className="h-3.5 w-3.5" />}
              <span>
                {syncingBuffer ? "Puxando contas..." : "Puxar contas do Zernio"}
              </span>
            </Button>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Parâmetros da Agenda Automática"
        description="Ajuste o fuso horário de referência, a quantidade diária de publicações por conta e as janelas de sorteio dos horários."
        icon={<SlidersHorizontal className="h-4 w-4" />}
        actions={<Badge tone="blue">Configuração de Rotina</Badge>}
        data-testid="card-routine-settings"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <Field
              label="Fuso Horário (Timezone)"
              htmlFor="input-timezone"
              hint="Utilizado para sorteio e verificação das janelas locais."
            >
              <Input
                id="input-timezone"
                type="text"
                value={tzInput}
                onChange={(e) => setTzInput(e.target.value)}
                placeholder="America/Sao_Paulo"
                data-testid="input-timezone"
              />
            </Field>
            <Button
              variant="outline"
              size="sm"
              className="self-end"
              onClick={() => void handleSaveTimezone()}
              disabled={Boolean(savingKey) || loading}
              isLoading={savingKey === "auto_post_timezone"}
              data-testid="btn-save-timezone"
            >
              {savingKey === "auto_post_timezone"
                ? "Salvando..."
                : "Salvar Fuso"}
            </Button>
          </div>

          <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <Field
              label="Posts por Dia por Conta (1 a 6)"
              htmlFor="input-count"
              hint="Número de janelas/slots gerados por conta em cada dia."
            >
              <Input
                id="input-count"
                type="number"
                min={1}
                max={6}
                value={countInput}
                onChange={(e) =>
                  setCountInput(parseInt(e.target.value, 10) || 1)
                }
                data-testid="input-count-per-day"
              />
            </Field>
            <Button
              variant="outline"
              size="sm"
              className="self-end"
              onClick={() => void handleSaveCount()}
              disabled={Boolean(savingKey) || loading}
              isLoading={savingKey === "auto_post_count_per_day"}
              data-testid="btn-save-count"
            >
              {savingKey === "auto_post_count_per_day"
                ? "Salvando..."
                : "Salvar Quantidade"}
            </Button>
          </div>

          <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:col-span-2 xl:col-span-1">
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">
                  Janelas de Horário
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={handleAddWindow}
                  title="Adicionar nova janela"
                >
                  <Plus className="h-3 w-3" />
                  <span>Adicionar</span>
                </Button>
              </div>
              <p className="mb-2 text-[11px] text-slate-500">
                Intervalos de horas (HH:mm) para agendamento dos posts.
              </p>
              <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
                {windowsInput.map((win, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <Input
                      type="text"
                      className="h-8 w-24 px-2 text-xs"
                      value={win.id}
                      placeholder="id"
                      onChange={(e) =>
                        handleWindowChange(idx, "id", e.target.value)
                      }
                    />
                    <Input
                      type="text"
                      className="h-8 w-16 px-2 text-xs"
                      value={win.start}
                      placeholder="07:00"
                      onChange={(e) =>
                        handleWindowChange(idx, "start", e.target.value)
                      }
                    />
                    <span className="text-xs text-slate-400">–</span>
                    <Input
                      type="text"
                      className="h-8 w-16 px-2 text-xs"
                      value={win.end}
                      placeholder="09:00"
                      onChange={(e) =>
                        handleWindowChange(idx, "end", e.target.value)
                      }
                    />
                    {windowsInput.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-red-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => handleRemoveWindow(idx)}
                        title="Remover janela"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="self-end"
              onClick={() => void handleSaveWindows()}
              disabled={Boolean(savingKey) || loading}
              isLoading={savingKey === "auto_post_windows"}
              data-testid="btn-save-windows"
            >
              {savingKey === "auto_post_windows"
                ? "Salvando..."
                : "Salvar Janelas"}
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={`Agenda de Postagens (${schedule?.date || "Hoje"})`}
        description={
          <>
            Fuso horário:{" "}
            <strong className="font-semibold text-slate-700">
              {schedule?.timezone ||
                settings.auto_post_timezone ||
                "America/Sao_Paulo"}
            </strong>{" "}
            | Estado da rotina:{" "}
            <strong
              className={
                routineActive
                  ? "font-semibold text-emerald-700"
                  : "font-semibold text-amber-700"
              }
            >
              {routineActive ? "Ativo" : "Desativado"}
            </strong>
          </>
        }
        icon={<CalendarDays className="h-4 w-4" />}
        actions={
          <div className="flex items-center gap-2">
            <Input
              type="date"
              className="h-8 w-auto py-1 text-xs"
              value={scheduleDate}
              onChange={(e) => {
                setScheduleDate(e.target.value);
                void loadSchedule(e.target.value);
              }}
              data-testid="input-agenda-date"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadSchedule(scheduleDate || undefined)}
              disabled={scheduleLoading}
              data-testid="btn-reload-agenda"
            >
              <RefreshCw
                className={
                  scheduleLoading
                    ? "h-3.5 w-3.5 animate-spin text-blue-600"
                    : "h-3.5 w-3.5"
                }
              />
              <span>{scheduleLoading ? "Atualizando..." : "Recarregar Agenda"}</span>
            </Button>
          </div>
        }
        data-testid="card-agenda-panel"
      >
        {scheduleError && (
          <div className="mb-3" data-testid="agenda-error-banner">
            <InlineAlert tone="error">{scheduleError}</InlineAlert>
          </div>
        )}

        <Table data-testid="agenda-table">
          <TableHead>
            <TableRow className="hover:bg-transparent">
              <TableHeaderCell>Horário</TableHeaderCell>
              <TableHeaderCell>Conta</TableHeaderCell>
              <TableHeaderCell>Canal</TableHeaderCell>
              <TableHeaderCell>Status da Execução</TableHeaderCell>
              <TableHeaderCell>Desfecho da Publicação</TableHeaderCell>
              <TableHeaderCell>Erro / Detalhes</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {scheduleError ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-6 text-center font-medium text-red-600"
                  data-testid="agenda-error-row"
                >
                  <AlertTriangle className="mr-1 inline h-4 w-4" />
                  {scheduleError}
                </TableCell>
              </TableRow>
            ) : !schedule || schedule.slots.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-6 text-center italic text-slate-400"
                  data-testid="agenda-empty-row"
                >
                  Nenhum slot agendado para esta data.
                </TableCell>
              </TableRow>
            ) : (
              schedule.slots.map((slot: AutoPostSlot) => (
                <TableRow
                  key={slot.id}
                  disabled={!slot.account_enabled}
                  data-testid="agenda-slot-row"
                >
                  <TableCell>
                    <strong className="font-semibold text-slate-800">
                      {formatSlotTime(slot.scheduled_at)}
                    </strong>
                    <div
                      className="text-[11px] text-slate-400"
                      title={slot.scheduled_at}
                    >
                      Janela: {slot.window_id}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-slate-900">
                        {slot.account_display_name || slot.account_id}
                      </span>
                      {!slot.account_enabled && (
                        <Badge
                          tone="amber"
                          title="Conta desabilitada"
                          data-testid="account-disabled-badge"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          Desativada
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      @{slot.account_id}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge tone="blue" pill>
                      {formatScheduleChannel(slot.channel)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span data-testid={`slot-status-${slot.id}`}>
                      <StatusBadge
                        status={slot.status}
                        label={formatScheduleStatus(slot.status)}
                      />
                    </span>
                  </TableCell>
                  <TableCell className="font-medium text-slate-700">
                    {formatPublicationStatus(slot.post_status)}
                  </TableCell>
                  <TableCell>
                    {slot.last_error ? (
                      <span
                        className="font-mono text-xs text-red-600"
                        title={slot.last_error}
                      >
                        {slot.last_error}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </SectionCard>
    </div>
  );
}
