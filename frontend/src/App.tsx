import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { Menu, Users } from "lucide-react";
import { cn } from "./ui";
import {
  DEFAULT_TAB,
  buildTabUrl,
  parseDeepLinkParams,
  resolveLocation,
  type ResolvedLocation,
} from "./navigation";

export { parseDeepLinkParams };

const TAB_TITLES: Record<NavTab, string> = {
  desempenho: "Desempenho de Carrosséis",
  galeria: "Galeria de Carrosséis",
  contas: "Configuração de Contas",
  textos: "Biblioteca de Textos",
  midias: "Biblioteca de Mídias",
  integracoes: "Integrações & Despacho",
};

const APP_TITLE = "Listo Ops Studio";

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function ShellContent(): React.JSX.Element {
  const initialLocation: ResolvedLocation =
    typeof window !== "undefined"
      ? resolveLocation(window.location.pathname, window.location.search)
      : { tab: DEFAULT_TAB, runId: undefined, url: buildTabUrl(DEFAULT_TAB) };

  const [currentTab, setCurrentTab] = useState<NavTab>(initialLocation.tab);
  const [focusedRunId, setFocusedRunId] = useState<string | undefined>(
    initialLocation.runId
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const { selectedAccountId, selectedAccount } = useAccount();

  const applyLocation = useCallback((location: ResolvedLocation) => {
    setCurrentTab(location.tab);
    setFocusedRunId(location.runId);
  }, []);

  // Normalize the initial URL (e.g. `/` -> `/desempenho`, legacy
  // `/?tab=galeria&run=<id>` -> `/galeria?run=<id>`) and follow history.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const initial = resolveLocation(window.location.pathname, window.location.search);
    if (currentUrl() !== initial.url) {
      window.history.replaceState({ tab: initial.tab }, "", initial.url);
    }

    const handlePopState = () => {
      applyLocation(
        resolveLocation(window.location.pathname, window.location.search)
      );
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [applyLocation]);

  const navigateToTab = useCallback((tab: NavTab) => {
    setCurrentTab(tab);
    setFocusedRunId(undefined);

    if (typeof window === "undefined") return;
    const url = buildTabUrl(tab);
    if (currentUrl() === url) return;
    window.history.pushState({ tab }, "", url);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = `${TAB_TITLES[currentTab]} · ${APP_TITLE}`;
  }, [currentTab]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [currentTab]);

  const isPinned = selectedAccountId !== "all";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50">
      <div className="hidden lg:block">
        <Sidebar currentTab={currentTab} onSelectTab={navigateToTab} />
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 shadow-2xl">
            <Sidebar
              currentTab={currentTab}
              onSelectTab={navigateToTab}
              onNavigate={() => setMobileNavOpen(false)}
              onClose={() => setMobileNavOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[60px] min-h-[60px] items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 shadow-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <h1 className="truncate text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
              {TAB_TITLES[currentTab]}
            </h1>
          </div>

          <div className="flex flex-none items-center">
            <span
              className={cn(
                "inline-flex max-w-[52vw] items-center gap-1.5 truncate rounded-full border px-3 py-1 text-xs font-medium sm:max-w-none",
                isPinned
                  ? "border-blue-200 bg-blue-50 font-semibold text-blue-700"
                  : "border-slate-200 bg-slate-100 text-slate-600"
              )}
              title={
                isPinned
                  ? `Contexto: @${selectedAccount?.id ?? selectedAccountId}`
                  : "Contexto: Todas as contas"
              }
            >
              <Users className="h-3.5 w-3.5 flex-none" />
              <span className="truncate">
                {isPinned
                  ? `@${selectedAccount?.id ?? selectedAccountId}${
                      selectedAccount?.role ? ` [${selectedAccount.role}]` : ""
                    }`
                  : "Todas as contas"}
              </span>
            </span>
          </div>
        </header>

        <main
          ref={mainRef}
          className="flex-1 overflow-y-auto p-4 sm:p-6"
          data-testid={`tab-content-${currentTab}`}
        >
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
            <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
              <span className="w-fit rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-600">
                Scaffold / {currentTab}
              </span>
              <h3 className="text-lg font-semibold text-slate-900">
                {TAB_TITLES[currentTab]}
              </h3>
              <p className="text-sm text-slate-500">
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
