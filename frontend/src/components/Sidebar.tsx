import React from "react";
import type { NavTab } from "../types";
import { useAccount } from "../context";
import { useAuth } from "./LoginGate";
import { TAB_PATHS } from "../navigation";
import {
  TrendingUp,
  Image as GalleryIcon,
  Users,
  FileText,
  FolderArchive,
  Cpu,
  LogOut,
  Layers,
  X,
} from "lucide-react";
import { cn } from "../ui";

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onNavigate?: () => void;
  onClose?: () => void;
}

interface NavGroup {
  title: string;
  items: {
    id: NavTab;
    label: string;
    sublabel?: string;
    icon: React.ComponentType<{ className?: string }>;
  }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Carrosséis",
    items: [
      { id: "desempenho", label: "Desempenho", icon: TrendingUp },
      { id: "galeria", label: "Galeria", icon: GalleryIcon },
    ],
  },
  {
    title: "Configuração",
    items: [
      { id: "contas", label: "Contas", icon: Users },
      { id: "textos", label: "Textos", sublabel: "shared | role", icon: FileText },
      { id: "midias", label: "Mídias", sublabel: "shared | role", icon: FolderArchive },
      {
        id: "integracoes",
        label: "Integrações",
        sublabel: "auto-dispatch, TikTok, TG",
        icon: Cpu,
      },
    ],
  },
];

export function Sidebar({
  currentTab,
  onSelectTab,
  onNavigate,
  onClose,
}: SidebarProps): React.JSX.Element {
  const { selectedAccountId, setSelectedAccountId, accounts, loading } =
    useAccount();
  const { logout } = useAuth();

  const handleSelect = (tab: NavTab) => {
    onSelectTab(tab);
    onNavigate?.();
  };

  return (
    <aside className="flex h-full w-[280px] flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-500 text-white shadow-sm shadow-blue-600/20">
          <Layers className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-tight text-slate-900">
            Listo Ops Studio
          </h1>
          <p className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Marketing Carousel Ops
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-4">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-slate-400" />
          <label
            htmlFor="account-context-select"
            className="text-[10px] font-bold uppercase tracking-wider text-slate-500"
          >
            Contexto da Conta
          </label>
        </div>
        <select
          id="account-context-select"
          className="w-full cursor-pointer appearance-auto rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100"
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          disabled={loading && accounts.length === 0}
        >
          <option value="all">Todas as contas</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              @{account.id}
              {account.display_name ? ` (${account.display_name})` : ""} [
              {account.role}]
            </option>
          ))}
        </select>
        {loading && (
          <span className="mt-1 block text-[11px] text-slate-400">
            Carregando contas...
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {group.title}
            </h3>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = currentTab === item.id;
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <a
                      href={TAB_PATHS[item.id]}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                        isActive
                          ? "bg-blue-50 font-semibold text-blue-700 ring-1 ring-inset ring-blue-100"
                          : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      )}
                      onClick={(event) => {
                        // Modifier/middle clicks keep native browser behavior.
                        if (
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey ||
                          event.button !== 0
                        ) {
                          onNavigate?.();
                          return;
                        }
                        event.preventDefault();
                        handleSelect(item.id);
                      }}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Icon
                          className={cn(
                            "h-4 w-4 flex-none",
                            isActive ? "text-blue-600" : "text-slate-400"
                          )}
                        />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.sublabel && (
                        <span className="hidden flex-none rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium text-slate-500 xl:inline">
                          {item.sublabel}
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
          onClick={logout}
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Sair</span>
        </button>
      </div>
    </aside>
  );
}
