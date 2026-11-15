import React from "react";
import type { NavTab } from "../types";
import { useAccount } from "../context";
import { useAuth } from "./LoginGate";

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
  }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Carrosséis",
    items: [
      { id: "desempenho", label: "Desempenho" },
      { id: "galeria", label: "Galeria" },
      { id: "gerar", label: "Gerar" },
    ],
  },
  {
    title: "Configuração",
    items: [
      { id: "contas", label: "Contas" },
      { id: "textos", label: "Textos", sublabel: "shared | role" },
      { id: "midias", label: "Mídias", sublabel: "shared | role" },
      {
        id: "integracoes",
        label: "Integrações",
        sublabel: "auto-dispatch, TikTok, TG",
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
          <span className="brand-version">v2</span>
        </div>
      </div>

      <div className="context-switcher">
        <label htmlFor="account-context-select" className="context-label">
          Contexto da Conta
        </label>
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
                return (
                  <li key={item.id} className="nav-item">
                    <button
                      type="button"
                      className={`nav-button ${isActive ? "active" : ""}`}
                      onClick={() => onSelectTab(item.id)}
                    >
                      <span className="nav-label">{item.label}</span>
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
          className="btn btn-outline btn-sm btn-logout"
          onClick={logout}
        >
          Sair
        </button>
      </div>
    </aside>
  );
}
