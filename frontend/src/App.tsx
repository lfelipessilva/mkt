import React, { useState, useEffect } from "react";
import type { NavTab } from "./types";
import { AccountProvider, useAccount } from "./context";
import { LoginGate } from "./components/LoginGate";
import { Sidebar } from "./components/Sidebar";
import { AccountsPage } from "./tabs/settings/AccountsPage";
import { TextsPage } from "./tabs/settings/TextsPage";
import { MediaPage } from "./tabs/settings/MediaPage";
import { GalleryPage } from "./tabs/GalleryPage";
import { PerformancePage } from "./tabs/PerformancePage";
import { IntegrationsPage } from "./tabs/IntegrationsPage";

const TAB_TITLES: Record<NavTab, string> = {
  desempenho: "Desempenho de Carrosséis",
  galeria: "Galeria de Carrosséis",
  contas: "Configuração de Contas",
  textos: "Biblioteca de Textos",
  midias: "Biblioteca de Mídias",
  integracoes: "Integrações & Despacho",
};

const VALID_TABS: readonly NavTab[] = [
  "desempenho",
  "galeria",
  "contas",
  "textos",
  "midias",
  "integracoes",
];

export function parseDeepLinkParams(search: string): { tab?: NavTab; runId?: string } {
  if (!search) return {};
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (!query) return {};

  const params = new URLSearchParams(query);
  const rawTab = params.get("tab");
  const rawRun = params.get("run") || params.get("runId");

  const result: { tab?: NavTab; runId?: string } = {};

  if (rawTab && (VALID_TABS as readonly string[]).includes(rawTab)) {
    result.tab = rawTab as NavTab;
  }
  if (rawRun && rawRun.trim().length > 0) {
    result.runId = rawRun.trim();
  }

  return result;
}

function ShellContent(): React.JSX.Element {
  const initialDeepLink =
    typeof window !== "undefined" ? parseDeepLinkParams(window.location.search) : {};
  const [currentTab, setCurrentTab] = useState<NavTab>(
    initialDeepLink.tab ?? "desempenho"
  );
  const [focusedRunId, setFocusedRunId] = useState<string | undefined>(
    initialDeepLink.runId
  );
  const { selectedAccountId, selectedAccount } = useAccount();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const params = parseDeepLinkParams(window.location.search);
      if (params.tab) {
        setCurrentTab(params.tab);
      }
      setFocusedRunId(params.runId);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  return (
    <div className="app-shell">
      <Sidebar currentTab={currentTab} onSelectTab={setCurrentTab} />

      <div className="main-wrapper">
        <header className="main-header">
          <div className="header-left">
            <h2 className="page-title">{TAB_TITLES[currentTab]}</h2>
          </div>
          <div className="header-right">
            {selectedAccountId === "all" ? (
              <span className="context-badge">Contexto: Todas as contas</span>
            ) : (
              <span className="context-badge pinned">
                Contexto: @{selectedAccount?.id ?? selectedAccountId}
                {selectedAccount?.role ? ` [${selectedAccount.role}]` : ""}
              </span>
            )}
          </div>
        </header>

        <main className="main-content" data-testid={`tab-content-${currentTab}`}>
          {currentTab === "desempenho" ? (
            <PerformancePage />
          ) : currentTab === "galeria" ? (
            <GalleryPage focusedRunId={focusedRunId} />
          ) : currentTab === "contas" ? (
            <AccountsPage />
          ) : currentTab === "textos" ? (
            <TextsPage />
          ) : currentTab === "midias" ? (
            <MediaPage />
          ) : currentTab === "integracoes" ? (
            <IntegrationsPage />
          ) : (
            <div className="scaffold-card">
              <span className="scaffold-badge">Scaffold / {currentTab}</span>
              <h3>{TAB_TITLES[currentTab]}</h3>
              <p>
                Visualização para a aba <strong>{currentTab}</strong> com contexto
                ativo em{" "}
                <strong>
                  {selectedAccountId === "all"
                    ? "Todas as contas"
                    : `@${selectedAccount?.id ?? selectedAccountId}`}
                </strong>
                .
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App(): React.JSX.Element {
  return (
    <LoginGate>
      <AccountProvider>
        <ShellContent />
      </AccountProvider>
    </LoginGate>
  );
}
