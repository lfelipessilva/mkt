import React, { useState } from "react";
import type { NavTab } from "./types";
import { AccountProvider, useAccount } from "./context";
import { LoginGate } from "./components/LoginGate";
import { Sidebar } from "./components/Sidebar";
import { AccountsPage } from "./tabs/settings/AccountsPage";
import { TextsPage } from "./tabs/settings/TextsPage";
import { MediaPage } from "./tabs/settings/MediaPage";
import { GeneratePage } from "./tabs/GeneratePage";
import { GalleryPage } from "./tabs/GalleryPage";
import { PerformancePage } from "./tabs/PerformancePage";
import { IntegrationsPage } from "./tabs/IntegrationsPage";

const TAB_TITLES: Record<NavTab, string> = {
  desempenho: "Desempenho de Carrosséis",
  galeria: "Galeria de Carrosséis",
  gerar: "Gerar Carrosséis",
  contas: "Configuração de Contas",
  textos: "Biblioteca de Textos",
  midias: "Biblioteca de Mídias",
  integracoes: "Integrações & Despacho",
};

function ShellContent(): React.JSX.Element {
  const [currentTab, setCurrentTab] = useState<NavTab>("desempenho");
  const { selectedAccountId, selectedAccount } = useAccount();

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
            <GalleryPage />
          ) : currentTab === "gerar" ? (
            <GeneratePage />
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
