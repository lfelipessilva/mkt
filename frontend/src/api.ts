import type { Account } from "./types";

export const TOKEN_STORAGE_KEY = "listo_api_token";

export function getToken(): string | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string): void {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
  }
}

export function clearToken(): void {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Prepend /api/v1 if not already absolute or prefixed
  let url = path;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    if (!url.startsWith("/api/v1")) {
      url = url.startsWith("/") ? `/api/v1${url}` : `/api/v1/${url}`;
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `API request failed with status ${response.status}`;
    let errorCode: string | undefined;

    try {
      const errJson = await response.json();
      if (errJson && typeof errJson === "object") {
        if ("message" in errJson && typeof errJson.message === "string") {
          errorMessage = errJson.message;
        }
        if ("error" in errJson && typeof errJson.error === "string") {
          errorCode = errJson.error;
        }
      }
    } catch {
      // Non-JSON error body
    }

    throw new ApiError(errorMessage, response.status, errorCode);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

export async function verifyToken(token?: string): Promise<boolean> {
  const tokenToTest = token ?? getToken();
  if (!tokenToTest) {
    return false;
  }

  try {
    const res = await fetch("/api/v1/ping", {
      headers: {
        Authorization: `Bearer ${tokenToTest.trim()}`,
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getAccounts(): Promise<Account[]> {
  return apiFetch<Account[]>("/accounts");
}
