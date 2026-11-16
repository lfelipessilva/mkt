export type AutomationNotifyEvent =
  | "generation_ok"
  | "generation_failed"
  | "awaiting_approval"
  | "buffer_accepted"
  | "publish_ok"
  | "publish_failed"
  | "telegram_sent";

export interface NotifyPayload {
  account: string;
  archetype?: string;
  reason?: string;
  runId?: string;
}

export interface TelegramApiLike {
  sendMessage: (
    chatId: string | number,
    text: string,
    extra?: { reply_markup?: unknown }
  ) => Promise<unknown>;
}

export interface NotifyAutomationOptions {
  telegramApi?: TelegramApiLike;
  chatId?: string | null;
  appBaseUrl?: string | null;
}

export function getNotifyChatId(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const notify = env.TELEGRAM_NOTIFY_CHAT_ID?.trim();
  if (notify) return notify;
  const chat = env.TELEGRAM_CHAT_ID?.trim();
  return chat || null;
}

export function buildApprovalKeyboard(
  runId: string,
  appBaseUrl?: string | null
): { inline_keyboard: Array<Array<Record<string, string>>> } {
  const confirm = {
    text: "Confirmar envio",
    callback_data: `approve_buffer:${runId}`,
  };
  const base = appBaseUrl?.trim().replace(/\/$/, "");
  if (!base) {
    return { inline_keyboard: [[confirm]] };
  }
  return {
    inline_keyboard: [
      [
        {
          text: "🔗 Abrir carrossel",
          url: `${base}/?tab=galeria&run=${runId}`,
        },
        confirm,
      ],
    ],
  };
}

function formatMessage(
  event: AutomationNotifyEvent,
  payload: NotifyPayload
): string {
  const account = payload.account;
  switch (event) {
    case "generation_ok":
      return `✅ Carrossel gerado — @${account} — arquétipo: ${payload.archetype ?? ""}`;
    case "generation_failed":
      return `❌ Falha ao gerar — @${account} — ${payload.reason ?? ""}`;
    case "awaiting_approval":
      return `🕐 Aguardando aprovação — @${account} — arquétipo: ${payload.archetype ?? ""}`;
    case "buffer_accepted":
      return `📤 No Buffer em ~30min — @${account} — abre o Buffer, adiciona a música e publica`;
    case "publish_ok":
      return `✅ Publicado no TikTok — @${account} — arquétipo: ${payload.archetype ?? ""}`;
    case "publish_failed":
      return `❌ Falha na publicação — @${account} — ${payload.reason ?? ""}`;
    case "telegram_sent":
      return `✅ Enviado ao Telegram — @${account} — arquétipo: ${payload.archetype ?? ""}`;
  }
}

export async function notifyAutomation(
  event: AutomationNotifyEvent,
  payload: NotifyPayload,
  options: NotifyAutomationOptions = {}
): Promise<void> {
  const chatId =
    options.chatId !== undefined ? options.chatId : getNotifyChatId();
  if (!chatId || !options.telegramApi) return;

  const text = formatMessage(event, payload);
  const extra: { reply_markup?: unknown } = {};
  if (event === "awaiting_approval" && payload.runId) {
    const baseUrl =
      options.appBaseUrl !== undefined
        ? options.appBaseUrl
        : process.env.APP_BASE_URL;
    extra.reply_markup = buildApprovalKeyboard(payload.runId, baseUrl);
  }

  await options.telegramApi.sendMessage(chatId, text, extra);
}
