import React, { useState, useEffect, createContext, useContext } from "react";
import { getToken, setToken, clearToken, verifyToken } from "../api";
import { ShieldCheck, KeyRound } from "lucide-react";
import { Button, Field, InlineAlert, Input } from "../ui";

interface AuthContextType {
  token: string | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  logout: () => {},
});

export const useAuth = (): AuthContextType => useContext(AuthContext);

interface LoginGateProps {
  children: React.ReactNode;
}

export function LoginGate({ children }: LoginGateProps): React.JSX.Element {
  const [token, setStoredToken] = useState<string | null>(() => getToken());
  const [inputVal, setInputVal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStoredToken(getToken());
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanToken = inputVal.trim();
    if (!cleanToken) {
      setError("Por favor, informe o token de autenticação.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const isValid = await verifyToken(cleanToken);
      if (!isValid) {
        setError("Token inválido ou não autorizado pela API.");
        setLoading(false);
        return;
      }

      setToken(cleanToken);
      setStoredToken(cleanToken);
      setInputVal("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro de conexão ao verificar o token."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearToken();
    setStoredToken(null);
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50 p-5">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-900/5 sm:p-8">
          <div className="mb-6 text-center">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-blue-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Listo Ops Studio</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Marketing Carousel Ops
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Insira seu Bearer Token para acessar o painel de operações.
            </p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-slate-400" />
                  API Bearer Token
                </span>
              }
              htmlFor="token-input"
            >
              <Input
                id="token-input"
                type="password"
                placeholder="Insira o API Token..."
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                autoFocus
                disabled={loading}
              />
            </Field>

            {error && <InlineAlert tone="error">{error}</InlineAlert>}

            <Button
              type="submit"
              variant="primary"
              block
              isLoading={loading}
              disabled={!inputVal.trim()}
            >
              {loading ? "Verificando..." : "Entrar no Painel"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ token, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}
