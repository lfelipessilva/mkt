import React from "react";
import type { NavTab } from "../types";
import { useAccount } from "../context";
import { useAuth } from "./LoginGate";
import {
  TrendingUp,
  Image as GalleryIcon,
  Sparkles,
  Users,
  FileText,
  FolderArchive,
  Cpu,
  LogOut,
  Layers,
} from "lucide-react";

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
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
      { id: "gerar", label: "Gerar", icon: Sparkles },
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
}: SidebarProps): React.JSX.Element {
  const { selectedAccountId, setSelectedAccountId, accounts, loading } =
    useAccount();
  const { logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-badge">Listo</div>
        <div className="brand-info">
          <h1>Carousel Ops</h1>
          <span className="brand-version">Clean Studio v2</span>
        </div>
      </div>

      <div className="context-switcher">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Layers className="w-3.5 h-3.5 text-slate-500" />
          <label htmlFor="account-context-select" className="context-label !mb-0">
            Contexto da Conta
          </label>
        </div>
        <div className="select-wrapper">
          <select
            id="account-context-select"
            className="account-select"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            disabled={loading && accounts.length === 0}
          >
            <option value="all">Todas as contas</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                @{account.id}{" "}
                {account.display_name ? `(${account.display_name})` : ""} [
                {account.role}]
              </option>
            ))}
          </select>
        </div>
        {loading && (
          <span className="context-loading">Carregando contas...</span>
        )}
      </div>

      <nav className="sidebar-nav">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="nav-group">
            <h3 className="nav-group-title">{group.title}</h3>
            <ul className="nav-list">
              {group.items.map((item) => {
                const isActive = currentTab === item.id;
                const Icon = item.icon;
                return (
                  <li key={item.id} className="nav-item">
                    <button
                      type="button"
                      className={`nav-button ${isActive ? "active" : ""}`}
                      onClick={() => onSelectTab(item.id)}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={`w-4 h-4 ${isActive ? "text-blue-600" : "text-slate-500"}`} />
                        <span className="nav-label">{item.label}</span>
                      </div>
                      {item.sublabel && (
                        <span className="nav-sublabel">{item.sublabel}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="btn btn-outline btn-sm btn-logout w-full flex items-center justify-center gap-2"
          onClick={logout}
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sair</span>
        </button>
      </div>
    </aside>
  );
}
