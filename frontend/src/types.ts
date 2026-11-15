export type AccountRole =
  | "single_man"
  | "single_woman"
  | "couple_men"
  | "couple_women";

export interface Account {
  id: string;
  display_name?: string | null;
  persona: string;
  role: AccountRole;
  enabled: boolean;
  tiktok_open_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type NavTab =
  | "desempenho"
  | "galeria"
  | "gerar"
  | "contas"
  | "textos"
  | "midias"
  | "integracoes";

export interface AccountContextValue {
  selectedAccountId: string; // "all" | accountId
  setSelectedAccountId: (id: string) => void;
  accounts: Account[];
  selectedAccount: Account | null;
  loading: boolean;
  error: string | null;
  reloadAccounts: () => Promise<void>;
}
