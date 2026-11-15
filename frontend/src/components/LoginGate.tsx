import React, { useState, useEffect, createContext, useContext } from "react";
import { getToken, setToken, clearToken, verifyToken } from "../api";

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

  // Sync token state if local storage changes
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
      <div className="login-screen">
        <div className="login-card">
          <div className="login-header">
            <div className="logo-badge">Listo Ops</div>
            <h2>Marketing Carousel Ops v2</h2>
            <p>Insira seu Bearer Token para acessar o painel de operações.</p>
          </div>

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label htmlFor="token-input">API Bearer Token</label>
              <input
                id="token-input"
                type="password"
                placeholder="Insira o API Token..."
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                autoFocus
                disabled={loading}
              />
            </div>

            {error && <div className="error-banner">{error}</div>}

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading || !inputVal.trim()}
            >
              {loading ? "Verificando..." : "Entrar no Painel"}
            </button>
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
