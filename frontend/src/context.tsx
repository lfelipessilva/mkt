import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
  useMemo,
} from "react";
import type { Account, AccountContextValue } from "./types";
import { getAccounts } from "./api";

export interface AccountState {
  selectedAccountId: string; // "all" | accountId
  accounts: Account[];
  loading: boolean;
  error: string | null;
}

export const initialAccountState: AccountState = {
  selectedAccountId: "all",
  accounts: [],
  loading: false,
  error: null,
};

export type AccountAction =
  | { type: "SET_ACCOUNT"; payload: string }
  | { type: "SET_ACCOUNTS"; payload: Account[] }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null };

export function accountReducer(
  state: AccountState,
  action: AccountAction
): AccountState {
  switch (action.type) {
    case "SET_ACCOUNT":
      return {
        ...state,
        selectedAccountId: action.payload,
      };
    case "SET_ACCOUNTS":
      return {
        ...state,
        accounts: action.payload,
        loading: false,
        error: null,
      };
    case "SET_LOADING":
      return {
        ...state,
        loading: action.payload,
      };
    case "SET_ERROR":
      return {
        ...state,
        error: action.payload,
        loading: false,
      };
    default:
      return state;
  }
}

export function resolveSelectedAccount(
  accounts: Account[],
  selectedAccountId: string
): Account | null {
  if (selectedAccountId === "all") {
    return null;
  }
  return accounts.find((acc) => acc.id === selectedAccountId) || null;
}

const AccountContext = createContext<AccountContextValue | undefined>(
  undefined
);

export function AccountProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [state, dispatch] = useReducer(accountReducer, initialAccountState);

  const reloadAccounts = useCallback(async () => {
    dispatch({ type: "SET_LOADING", payload: true });
    try {
      const data = await getAccounts();
      dispatch({ type: "SET_ACCOUNTS", payload: data });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Erro ao carregar contas";
      dispatch({ type: "SET_ERROR", payload: message });
    }
  }, []);

  useEffect(() => {
    void reloadAccounts();
  }, [reloadAccounts]);

  const setSelectedAccountId = useCallback((id: string) => {
    dispatch({ type: "SET_ACCOUNT", payload: id });
  }, []);

  const selectedAccount = useMemo(() => {
    return resolveSelectedAccount(state.accounts, state.selectedAccountId);
  }, [state.accounts, state.selectedAccountId]);

  const value: AccountContextValue = useMemo(
    () => ({
      selectedAccountId: state.selectedAccountId,
      setSelectedAccountId,
      accounts: state.accounts,
      selectedAccount,
      loading: state.loading,
      error: state.error,
      reloadAccounts,
    }),
    [
      state.selectedAccountId,
      setSelectedAccountId,
      state.accounts,
      selectedAccount,
      state.loading,
      state.error,
      reloadAccounts,
    ]
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error("useAccount must be used within an AccountProvider");
  }
  return context;
}
