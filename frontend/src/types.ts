export const ACCOUNT_ROLES = [
  "single_man",
  "single_woman",
  "couple_men",
  "couple_women",
] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export function isValidRole(role: string): role is AccountRole {
  return ACCOUNT_ROLES.includes(role as AccountRole);
}

export const ROLE_LABELS: Record<AccountRole, string> = {
  single_man: "Homem Solteiro",
  single_woman: "Mulher Solteira",
  couple_men: "Casal Homen",
  couple_women: "Casal Mulher",
};

export interface Account {
  id: string;
  display_name?: string | null;
  persona: string;
  role: AccountRole;
  enabled: boolean;
  auto_post_enabled?: boolean;
  tiktok_open_id?: string | null;
  social_provider?: string | null;
  external_account_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAccountInput {
  id: string;
  display_name?: string | null;
  persona: string;
  role: AccountRole;
  enabled?: boolean;
  auto_post_enabled?: boolean;
  tiktok_open_id?: string | null;
  social_provider?: string | null;
  external_account_id?: string | null;
}

export interface UpdateAccountInput {
  display_name?: string | null;
  persona?: string;
  role?: AccountRole;
  enabled?: boolean;
  auto_post_enabled?: boolean;
  tiktok_open_id?: string | null;
  social_provider?: string | null;
  external_account_id?: string | null;
}

export interface SyncAccountsResult {
  synced: number;
  matched: number;
  created: number;
  accounts: Array<{
    id: string;
    persona?: string;
    external_account_id?: string | null;
    social_provider?: string | null;
    username?: string;
  }>;
}

export function getBufferLinkageStatus(account: Account): {
  isLinked: boolean;
  label: string;
  externalAccountId: string | null;
  provider: string | null;
} {
  const isLinked = Boolean(account.external_account_id && account.external_account_id.trim());
  return {
    isLinked,
    label: isLinked ? `Zernio (${account.external_account_id})` : "Não vinculado",
    externalAccountId: account.external_account_id || null,
    provider: account.social_provider || null,
  };
}

export function validateAccountInput(input: {
  id?: string;
  role?: string;
  persona?: string;
  enabled?: boolean;
}): { valid: boolean; error?: string } {
  if (!input.id || !input.id.trim()) {
    return { valid: false, error: "ID da conta é obrigatório" };
  }
  const cleanId = input.id.trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(cleanId)) {
    return {
      valid: false,
      error: "ID deve conter apenas letras, números, sublinhados, pontos ou hífens",
    };
  }
  if (!input.role || !isValidRole(input.role)) {
    return {
      valid: false,
      error: `Role inválido. Permitidos: ${ACCOUNT_ROLES.join(", ")}`,
    };
  }
  return { valid: true };
}

export const CONTENT_SCOPES = [
  "shared",
  "single_man",
  "single_woman",
  "couple_men",
  "couple_women",
] as const;

export type ContentScope = (typeof CONTENT_SCOPES)[number];

export const MEDIA_SCOPES = [
  "shared",
  "single_man",
  "single_woman",
  "couple_men",
  "couple_women",
  "listo",
] as const;

export type MediaScope = (typeof MEDIA_SCOPES)[number];

export function resolveDefaultScope(
  selectedAccountId: string,
  selectedAccount: Account | null
): ContentScope {
  if (selectedAccountId !== "all" && selectedAccount?.role) {
    return selectedAccount.role;
  }
  return "shared";
}

export const SCOPE_LABELS: Record<ContentScope, string> = {
  shared: "Compartilhado (Geral)",
  single_man: "Homem Solteiro",
  single_woman: "Mulher Solteira",
  couple_men: "Casal Homens",
  couple_women: "Casal Mulheres",
};

export const MEDIA_SCOPE_LABELS: Record<MediaScope, string> = {
  shared: "Compartilhado (Geral)",
  single_man: "Homem Solteiro",
  single_woman: "Mulher Solteira",
  couple_men: "Casal Homens",
  couple_women: "Casal Mulheres",
  listo: "Listo Brand",
};

export interface Archetype {
  id: string;
  scope: ContentScope;
  title: string;
  sort_order: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ArchetypeInputItem {
  id?: string;
  title: string;
  sort_order?: number;
  active?: boolean;
}

export interface Bait {
  id: string;
  scope: ContentScope;
  body: string;
  sort_order: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface BaitInputItem {
  id?: string;
  body: string;
  sort_order?: number;
  active?: boolean;
}

export const MEDIA_CATEGORIES = ["cover", "random", "listo"] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export const MEDIA_CATEGORIES_FOR_SCOPE: Record<
  MediaScope,
  readonly MediaCategory[]
> = {
  shared: ["random"],
  single_man: ["cover", "random"],
  single_woman: ["cover", "random"],
  couple_men: ["cover", "random"],
  couple_women: ["cover", "random"],
  listo: ["listo"],
};

export interface MediaAsset {
  id: string;
  scope: MediaScope;
  category: MediaCategory;
  storage_path: string;
  filename: string;
  byte_size?: number | null;
  width?: number | null;
  height?: number | null;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CarouselSlide {
  id: string;
  run_id: string;
  position: number;
  storage_path: string;
  media_id?: string | null;
}

export type RunStatus =
  | "generating"
  | "generated"
  | "awaiting_approval"
  | "dispatching"
  | "dispatched"
  | "published"
  | "failed";

export interface CarouselRun {
  id: string;
  job_id?: string | null;
  auto_post_slot_id?: string | null;
  account_id: string;
  account_role?: AccountRole;
  archetype_title: string;
  bait_body?: string | null;
  tema?: string | null;
  legenda: string;
  status: RunStatus;
  output_dir?: string | null;
  error_message?: string | null;
  generated_at?: string | null;
  buffer_dispatched_at?: string | null;
  created_at?: string;
  updated_at?: string;
  slides?: CarouselSlide[];
}

export interface DispatchResult {
  ok: boolean;
  id: string;
  status: "pending" | "sent" | "failed";
  event: any;
  run: CarouselRun;
}

export type TikTokTrackingMode = "manual" | "api";

export interface TikTokPost {
  id: string;
  run_id: string;
  tracking_mode: TikTokTrackingMode;
  video_id?: string | null;
  video_url?: string | null;
  published_at?: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  metrics_note?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TikTokPerformanceItem {
  id: string;
  tiktok_post_id: string;
  run_id: string;
  account_id: string;
  account_role: string;
  account_display_name?: string | null;
  archetype_title: string;
  bait_body?: string | null;
  tema?: string | null;
  legenda: string;
  status: string;
  output_dir?: string | null;
  tracking_mode: TikTokTrackingMode | string;
  video_id?: string | null;
  video_url?: string | null;
  published_at?: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  metrics_note?: string | null;
  generated_at?: string | null;
  created_at?: string;
  updated_at?: string;
  run?: CarouselRun;
  post?: TikTokPost;
}

export interface UpsertTikTokPostInput {
  video_url?: string | null;
  video_id?: string | null;
  published_at?: string | Date | null;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  metrics_note?: string | null;
  tracking_mode?: TikTokTrackingMode;
}

export type TikTokPerformanceSortField =
  | "views"
  | "likes"
  | "comments"
  | "shares"
  | "published_at"
  | "created_at";

export interface GenerationJobProgress {
  id: string;
  jobId: string;
  status: "pending" | "running" | "completed" | "failed";
  account_ids: string[];
  total: number;
  completed: number;
  failed: number;
  started_at?: string | null;
  finished_at?: string | null;
  error_message?: string | null;
  created_at?: string;
  job?: any;
  runs?: CarouselRunSummary[];
}

export interface CarouselRunSummary {
  id: string;
  job_id?: string | null;
  account_id: string;
  account_role?: AccountRole;
  archetype_title?: string;
  bait_body?: string | null;
  tema?: string | null;
  legenda?: string;
  status: "generating" | "generated" | "dispatching" | "dispatched" | "published" | "failed";
  output_dir?: string | null;
  error_message?: string | null;
  generated_at?: string | null;
  created_at?: string;
}

export interface GenerateCarouselsInput {
  accountIds?: string[];
  mockCopy?: any;
  skipRender?: boolean;
}

export interface TikTokSyncRun {
  id: string;
  started_at: string;
  finished_at?: string | null;
  posts_updated: number;
  status: "pending" | "running" | "completed" | "failed";
  error_message?: string | null;
}

export interface PostWindow {
  id: string;
  start: string;
  end: string;
}

export type AutoPostSlotStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "done"
  | "failed"
  | "skipped";

export type AutoPostSlotChannel = "zernio" | "telegram" | "social";

export interface AutoPostSlot {
  id: string;
  window_id: string;
  account_id: string;
  account_display_name: string;
  account_enabled: boolean;
  channel: AutoPostSlotChannel | string;
  scheduled_at: string;
  window_end: string;
  status: AutoPostSlotStatus | string;
  attempts: number;
  run_id: string | null;
  run_status: string | null;
  post_status: string | null;
  last_error: string | null;
}

export interface AutomationSchedule {
  date: string;
  timezone: string;
  enabled: boolean;
  slots: AutoPostSlot[];
}

export type AutomationScheduleResponse = AutomationSchedule;

export function formatScheduleStatus(status: string): string {
  switch (status) {
    case "pending":
      return "Agendado";
    case "running":
      return "Gerando/Publicando";
    case "awaiting_approval":
      return "Aguardando aprovação";
    case "done":
      return "Enviado";
    case "failed":
      return "Falhou";
    case "skipped":
      return "Pulado";
    default:
      return status;
  }
}

export function formatScheduleChannel(channel: string): string {
  switch (channel) {
    case "zernio":
      return "Zernio";
    case "telegram":
      return "Telegram";
    case "social":
      return "Social";
    default:
      return channel;
  }
}

export function formatPublicationStatus(
  status: string | null | undefined
): string {
  if (!status) return "-";
  switch (status) {
    case "queued":
      return "Na fila";
    case "processing":
      return "Processando";
    case "published":
      return "Publicado";
    case "failed":
      return "Falhou";
    default:
      return status;
  }
}

export interface AppSettings {
  auto_dispatch_enabled?: boolean;
  auto_post_windows?: PostWindow[] | string;
  auto_post_count_per_day?: number;
  auto_post_timezone?: string;
  [key: string]: any;
}

export type NavTab =
  | "desempenho"
  | "galeria"
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
