import React, { useState, useEffect, useRef } from "react";
import { useAccount } from "../context";
import { ROLE_LABELS, type Account } from "../types";
import {
  generateCarousels,
  pollGenerationJob,
  type GenerationJobProgress,
} from "../api";

export type GenerateMode = "all_enabled" | "custom";

export function resolveTargetAccountIds(
  mode: GenerateMode,
  accounts: Account[],
  selectedIds: string[]
): string[] {
  if (mode === "all_enabled") {
    return accounts.filter((a) => a.enabled).map((a) => a.id);
  }
  const enabledMap = new Set(accounts.filter((a) => a.enabled).map((a) => a.id));
  return selectedIds.filter((id) => enabledMap.has(id));
}

interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

export function GeneratePage(): React.JSX.Element {
  const { accounts, selectedAccountId, loading: accountsLoading } = useAccount();

  const [mode, setMode] = useState<GenerateMode>("all_enabled");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeJob, setActiveJob] = useState<GenerationJobProgress | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize selectedIds when pinned account is set or accounts load
  useEffect(() => {
    if (selectedAccountId && selectedAccountId !== "all") {
      const match = accounts.find((a) => a.id === selectedAccountId);
      if (match && match.enabled) {
        setSelectedIds([match.id]);
        setMode("custom");
        return;
      }
    }
    // Default selectedIds: all enabled accounts
    const enabled = accounts.filter((a) => a.enabled).map((a) => a.id);
    setSelectedIds(enabled);
  }, [accounts, selectedAccountId]);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    const id = String(Date.now());
    setToast({ id, type, message });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 6000);
  };

  const handleToggleAccount = (accId: string) => {
    setSelectedIds((prev) =>
      prev.includes(accId) ? prev.filter((id) => id !== accId) : [...prev, accId]
    );
  };

  const handleSelectAllEnabled = () => {
    setSelectedIds(accounts.filter((a) => a.enabled).map((a) => a.id));
  };

  const handleDeselectAll = () => {
    setSelectedIds([]);
  };

  const targetAccountIds = resolveTargetAccountIds(mode, accounts, selectedIds);
  const targetCount = targetAccountIds.length;

  const handleStartGeneration = async () => {
    if (targetCount === 0 || isGenerating) return;

    setIsGenerating(true);
    showToast(
      `Iniciando geração de carrosséis para ${targetCount} ${targetCount === 1 ? "conta" : "contas"}...`,
      "info"
    );

    try {
      const initialJob = await generateCarousels({
        accountIds: targetAccountIds,
      });
      setActiveJob(initialJob);

      // Poll until completion
      const completedJob = await pollGenerationJob(initialJob.id, {
        intervalMs: 1500,
        onProgress: (p) => {
          setActiveJob(p);
        },
      });

      setActiveJob(completedJob);
      if (completedJob.status === "completed") {
        showToast(
          `Geração concluída com sucesso! ${completedJob.completed}/${completedJob.total} carrosséis gerados.`,
          "success"
        );
      } else {
        showToast(
          `Geração finalizada com avisos/falhas. Falhas: ${completedJob.failed}.`,
          "error"
        );
      }
    } catch (err: any) {
      showToast(`Erro na geração: ${err.message || String(err)}`, "error");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="generate-page" data-testid="generate-page">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`toast-alert toast-${toast.type}`}
          role="status"
          aria-live="polite"
        >
          <div className="toast-content">
            <span className="toast-icon">
              {toast.type === "success" ? "✓" : toast.type === "error" ? "⚠" : "ℹ"}
            </span>
            <span className="toast-message">{toast.message}</span>
          </div>
          <button
            type="button"
            className="toast-close"
            onClick={() => setToast(null)}
            title="Fechar notificação"
          >
            ×
          </button>
        </div>
      )}

      {/* Header section */}
      <div className="generate-header-card">
        <div className="header-info">
          <h2>Console de Geração</h2>
          <p className="page-desc">
            Dispare gerações em lote (1 carrossel por conta selecionada). O sistema
            combina arquétipos, iscas, capas e fotos aleatórias automaticamente.
          </p>
        </div>

        <div className="generate-action-box">
          <div className="counter-pill">
            <span className="counter-label">Contas selecionadas:</span>
            <span className="counter-value" data-testid="selected-count">
              {targetCount}
            </span>
          </div>

          <button
            type="button"
            className="btn-primary btn-generate"
            disabled={isGenerating || targetCount === 0 || accountsLoading}
            onClick={handleStartGeneration}
            data-testid="start-generate-btn"
          >
            {isGenerating ? (
              <>
                <span className="spinner-sm" style={{ width: 14, height: 14 }} />
                Gerando ({activeJob?.completed ?? 0}/{targetCount})...
              </>
            ) : (
              `Gerar ${targetCount} ${targetCount === 1 ? "Carrossel" : "Carrosséis"}`
            )}
          </button>
        </div>
      </div>

      {/* Active Job Progress Bar if running or recently completed */}
      {activeJob && (
        <div className="job-progress-card" data-testid="job-progress-card">
          <div className="job-progress-header">
            <div>
              <span className="job-id-tag">Job: {activeJob.id.slice(0, 8)}...</span>
              <span className={`status-badge status-${activeJob.status}`}>
                {activeJob.status === "running"
                  ? "Em processamento"
                  : activeJob.status === "completed"
                  ? "Concluído"
                  : activeJob.status === "failed"
                  ? "Falha"
                  : "Pendente"}
              </span>
            </div>
            <span className="job-numbers">
              {activeJob.completed + activeJob.failed} de {activeJob.total} processados
              ({activeJob.completed} sucesso{activeJob.failed > 0 ? `, ${activeJob.failed} falha` : ""})
            </span>
          </div>

          <div className="progress-bar-track">
            <div
              className={`progress-bar-fill ${
                activeJob.status === "completed"
                  ? "fill-success"
                  : activeJob.status === "failed"
                  ? "fill-error"
                  : ""
              }`}
              style={{
                width: `${
                  activeJob.total > 0
                    ? Math.round(((activeJob.completed + activeJob.failed) / activeJob.total) * 100)
                    : 0
                }%`,
              }}
            />
          </div>

          {activeJob.runs && activeJob.runs.length > 0 && (
            <div className="job-runs-list">
              <h4>Carrosséis gerados neste lote:</h4>
              <div className="runs-summary-grid">
                {activeJob.runs.map((r) => (
                  <div key={r.id} className="run-summary-pill">
                    <span className="run-acc">@{r.account_id}</span>
                    <span className="run-arch" title={r.archetype_title}>
                      {r.archetype_title}
                    </span>
                    <span className={`run-badge status-${r.status}`}>{r.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mode selection & accounts selector */}
      <div className="generate-config-card">
        <h3>Modo de Seleção</h3>

        <div className="mode-toggle-group">
          <label className={`mode-option ${mode === "all_enabled" ? "active" : ""}`}>
            <input
              type="radio"
              name="genMode"
              value="all_enabled"
              checked={mode === "all_enabled"}
              disabled={isGenerating}
              onChange={() => setMode("all_enabled")}
            />
            <div className="mode-text">
              <strong>Todas as contas ativas</strong>
              <span>Gera 1 carrossel para cada conta habilitada no sistema.</span>
            </div>
          </label>

          <label className={`mode-option ${mode === "custom" ? "active" : ""}`}>
            <input
              type="radio"
              name="genMode"
              value="custom"
              checked={mode === "custom"}
              disabled={isGenerating}
              onChange={() => setMode("custom")}
            />
            <div className="mode-text">
              <strong>Seleção manual de contas</strong>
              <span>Escolha via checkbox quais contas devem gerar agora.</span>
            </div>
          </label>
        </div>

        {/* Account check list */}
        <div className="account-selection-section">
          <div className="selection-toolbar">
            <span className="section-title">Contas Disponíveis</span>
            {mode === "custom" && (
              <div className="quick-actions">
                <button
                  type="button"
                  className="btn-link"
                  disabled={isGenerating}
                  onClick={handleSelectAllEnabled}
                >
                  Marcar todas habilitadas
                </button>
                <span className="sep">•</span>
                <button
                  type="button"
                  className="btn-link"
                  disabled={isGenerating}
                  onClick={handleDeselectAll}
                >
                  Desmarcar todas
                </button>
              </div>
            )}
          </div>

          <div className="accounts-checkbox-grid">
            {accounts.map((acc) => {
              const isChecked =
                mode === "all_enabled" ? acc.enabled : selectedIds.includes(acc.id);
              const isDisabled = isGenerating || mode === "all_enabled" || !acc.enabled;

              return (
                <label
                  key={acc.id}
                  className={`account-checkbox-card ${isChecked && acc.enabled ? "selected" : ""} ${
                    !acc.enabled ? "disabled" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={() => handleToggleAccount(acc.id)}
                  />
                  <div className="acc-card-info">
                    <div className="acc-card-top">
                      <span className="acc-id">@{acc.id}</span>
                      <span className="role-tag">{ROLE_LABELS[acc.role]}</span>
                    </div>
                    {acc.display_name && (
                      <span className="acc-name">{acc.display_name}</span>
                    )}
                    {!acc.enabled && (
                      <span className="disabled-notice">Conta desativada</span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
