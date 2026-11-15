import type {
  Account,
  CreateAccountInput,
  UpdateAccountInput,
  Archetype,
  ArchetypeInputItem,
  Bait,
  BaitInputItem,
  ContentScope,
  MediaAsset,
  MediaCategory,
  GenerateCarouselsInput,
  GenerationJobProgress,
} from "./types";

export type { GenerateCarouselsInput, GenerationJobProgress };

export const TOKEN_STORAGE_KEY = "listo_api_token";

let inMemoryToken: string | null = null;

export function getToken(): string | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  }
  return inMemoryToken;
}

export function setToken(token: string): void {
  const clean = token.trim();
  inMemoryToken = clean;
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.setItem(TOKEN_STORAGE_KEY, clean);
  }
}

export function clearToken(): void {
  inMemoryToken = null;
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

export async function createAccount(data: CreateAccountInput): Promise<Account> {
  return apiFetch<Account>("/accounts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateAccount(
  id: string,
  data: UpdateAccountInput
): Promise<Account> {
  return apiFetch<Account>(`/accounts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteAccount(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function getArchetypes(
  scope?: ContentScope
): Promise<Archetype[]> {
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  return apiFetch<Archetype[]>(`/archetypes${query}`);
}

export async function putArchetypes(
  scope: ContentScope,
  items: ArchetypeInputItem[]
): Promise<Archetype[]> {
  return apiFetch<Archetype[]>("/archetypes", {
    method: "PUT",
    body: JSON.stringify({ scope, items }),
  });
}

export async function deleteArchetype(
  id: string
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/archetypes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function getBaits(scope?: ContentScope): Promise<Bait[]> {
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  return apiFetch<Bait[]>(`/baits${query}`);
}

export async function putBaits(
  scope: ContentScope,
  items: BaitInputItem[]
): Promise<Bait[]> {
  return apiFetch<Bait[]>("/baits", {
    method: "PUT",
    body: JSON.stringify({ scope, items }),
  });
}

export async function deleteBait(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/baits/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export interface GetMediaOptions {
  scope?: ContentScope;
  category?: MediaCategory;
  active?: boolean;
}

export async function getMedia(
  options: GetMediaOptions = {}
): Promise<MediaAsset[]> {
  const params = new URLSearchParams();
  if (options.scope) params.set("scope", options.scope);
  if (options.category) params.set("category", options.category);
  if (options.active !== undefined) params.set("active", String(options.active));

  const query = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<MediaAsset[]>(`/media${query}`);
}

export async function uploadMedia(
  file: File | Blob,
  scope: ContentScope,
  category: MediaCategory
): Promise<MediaAsset> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("scope", scope);
  formData.append("category", category);

  return apiFetch<MediaAsset>("/media/upload", {
    method: "POST",
    body: formData,
  });
}

export async function deleteMedia(
  storagePath: string
): Promise<{ ok: boolean; deleted: string }> {
  return apiFetch<{ ok: boolean; deleted: string }>("/media", {
    method: "DELETE",
    body: JSON.stringify({ storage_path: storagePath }),
  });
}

export function getMediaFileUrl(storagePath: string): string {
  return `/api/v1/media/file?path=${encodeURIComponent(storagePath)}`;
}

export async function fetchMediaBlob(storagePath: string): Promise<string> {
  const url = getMediaFileUrl(storagePath);
  const token = getToken();
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new ApiError(
      `Failed to load media file: ${response.status}`,
      response.status
    );
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function generateCarousels(
  input: GenerateCarouselsInput = {}
): Promise<GenerationJobProgress> {
  return apiFetch<GenerationJobProgress>("/carousels/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getGenerationJob(
  jobId: string
): Promise<GenerationJobProgress> {
  return apiFetch<GenerationJobProgress>(
    `/carousels/jobs/${encodeURIComponent(jobId)}`
  );
}

export interface PollJobOptions {
  intervalMs?: number;
  maxAttempts?: number;
  onProgress?: (progress: GenerationJobProgress) => void;
}

export async function pollGenerationJob(
  jobId: string,
  options: PollJobOptions = {}
): Promise<GenerationJobProgress> {
  const intervalMs = options.intervalMs ?? 1500;
  const maxAttempts = options.maxAttempts ?? 120; // ~3 mins max by default
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    const progress = await getGenerationJob(jobId);
    if (options.onProgress) {
      options.onProgress(progress);
    }

    if (progress.status === "completed" || progress.status === "failed") {
      return progress;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Tempo limite de polling excedido para a geração do job ${jobId}`);
}
