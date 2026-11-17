import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getNotifyChatId,
  buildApprovalKeyboard,
  notifyAutomation,
  type AutomationNotifyEvent,
} from "../../src/domain/automation/notifications.js";

describe("automation notifications", () => {
  const prevNotify = process.env.TELEGRAM_NOTIFY_CHAT_ID;
  const prevChat = process.env.TELEGRAM_CHAT_ID;
  const prevBase = process.env.APP_BASE_URL;
  const prevBotToken = process.env.TELEGRAM_BOT_TOKEN;

  afterEach(() => {
    if (prevNotify === undefined) delete process.env.TELEGRAM_NOTIFY_CHAT_ID;
    else process.env.TELEGRAM_NOTIFY_CHAT_ID = prevNotify;
    if (prevChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = prevChat;
    if (prevBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = prevBase;
    if (prevBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prevBotToken;
  });

  it("getNotifyChatId prefers TELEGRAM_NOTIFY_CHAT_ID then TELEGRAM_CHAT_ID", () => {
    delete process.env.TELEGRAM_NOTIFY_CHAT_ID;
    delete process.env.TELEGRAM_CHAT_ID;
    assert.equal(getNotifyChatId(), null);

    process.env.TELEGRAM_CHAT_ID = "chat-main";
    assert.equal(getNotifyChatId(), "chat-main");

    process.env.TELEGRAM_NOTIFY_CHAT_ID = "chat-notify";
    assert.equal(getNotifyChatId(), "chat-notify");
  });

  it("buildApprovalKeyboard includes confirm callback and optional deep-link URL", () => {
    const runId = "11111111-1111-1111-1111-111111111111";
    const withoutUrl = buildApprovalKeyboard(runId);
    assert.equal(withoutUrl.inline_keyboard.length, 1);
    assert.equal(withoutUrl.inline_keyboard[0].length, 1);
    assert.equal(withoutUrl.inline_keyboard[0][0].text, "Confirmar envio");
    assert.equal(
      withoutUrl.inline_keyboard[0][0].callback_data,
      `approve_zernio:${runId}`
    );

    const withUrl = buildApprovalKeyboard(runId, "https://app.example.com");
    assert.equal(withUrl.inline_keyboard[0].length, 2);
    assert.equal(withUrl.inline_keyboard[0][0].text, "🔗 Abrir carrossel");
    assert.equal(
      withUrl.inline_keyboard[0][0].url,
      `https://app.example.com/?tab=galeria&run=${runId}`
    );
    assert.equal(withUrl.inline_keyboard[0][1].callback_data, `approve_zernio:${runId}`);
  });

  it("notifyAutomation sends Portuguese templates to notify chat", async () => {
    process.env.TELEGRAM_NOTIFY_CHAT_ID = "notify-42";
    const sent: Array<{ chatId: string; text: string; reply_markup?: unknown }> = [];

    const cases: Array<{
      event: AutomationNotifyEvent;
      payload: Record<string, string>;
      expect: RegExp;
      withKeyboard?: boolean;
    }> = [
      {
        event: "generation_ok",
        payload: { account: "gabriel", archetype: "Foco" },
        expect: /✅ Carrossel gerado — @gabriel — arquétipo: Foco/,
      },
      {
        event: "generation_failed",
        payload: { account: "gabriel", reason: "timeout" },
        expect: /❌ Falha ao gerar carrossel — @gabriel — motivo: timeout/,
      },
      {
        event: "awaiting_approval",
        payload: {
          account: "gabriel",
          archetype: "Foco",
          runId: "11111111-1111-1111-1111-111111111111",
        },
        expect: /🕐 Aguardando aprovação — @gabriel — arquétipo: Foco/,
        withKeyboard: true,
      },
      {
        event: "buffer_accepted",
        payload: { account: "gabriel", archetype: "Foco" },
        expect: /📤 Enviado ao Zernio \/ TikTok — @gabriel — arquétipo: Foco/,
      },
      {
        event: "publish_ok",
        payload: { account: "gabriel", archetype: "Foco" },
        expect: /✅ Publicado no TikTok — @gabriel — arquétipo: Foco/,
      },
      {
        event: "publish_failed",
        payload: { account: "gabriel", reason: "denied" },
        expect: /❌ Falha na publicação Zernio — @gabriel — motivo: denied/,
      },
      {
        event: "telegram_sent",
        payload: { account: "gabriel", archetype: "Foco" },
        expect: /✅ Enviado ao Telegram — @gabriel — arquétipo: Foco/,
      },
    ];

    for (const c of cases) {
      sent.length = 0;
      await notifyAutomation(c.event, c.payload as any, {
        telegramApi: {
          sendMessage: async (chatId: string, text: string, extra?: any) => {
            sent.push({ chatId, text, reply_markup: extra?.reply_markup });
          },
        },
      });
      assert.equal(sent.length, 1);
      assert.equal(sent[0].chatId, "notify-42");
      assert.match(sent[0].text, c.expect);
      if (c.withKeyboard) {
        assert.ok(sent[0].reply_markup);
      }
    }
  });

  it("notifyAutomation no-ops when no chat id is configured", async () => {
    delete process.env.TELEGRAM_NOTIFY_CHAT_ID;
    delete process.env.TELEGRAM_CHAT_ID;
    let called = false;
    await notifyAutomation(
      "generation_ok",
      { account: "x", archetype: "y" },
      {
        telegramApi: {
          sendMessage: async () => {
            called = true;
          },
        },
      }
    );
    assert.equal(called, false);
  });

  it("notifyAutomation creates Api client using TELEGRAM_BOT_TOKEN when options.telegramApi is undefined", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_NOTIFY_CHAT_ID;
    delete process.env.TELEGRAM_CHAT_ID;

    // With no bot token and no telegramApi, it should silently return without throwing
    await notifyAutomation("generation_ok", { account: "test" });

    // When TELEGRAM_BOT_TOKEN is set, it falls back to creating an Api client
    process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
    process.env.TELEGRAM_NOTIFY_CHAT_ID = "12345";

    const { Api } = await import("grammy");
    const originalSendMessage = Api.prototype.sendMessage;
    let interceptedCall: { token: string; chatId: string | number; text: string } | null = null;

    Api.prototype.sendMessage = (async function (
      this: { token: string },
      chatId: string | number,
      text: string,
      _extra?: any
    ) {
      interceptedCall = { token: this.token, chatId, text };
      return {} as any;
    }) as any;

    try {
      await notifyAutomation("publish_failed", {
        account: "pedro",
        reason: "network error",
      });

      assert.ok(interceptedCall !== null, "Api.prototype.sendMessage should have been called");
      assert.equal(
        (interceptedCall as { token: string }).token,
        "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
      );
      assert.equal((interceptedCall as { chatId: string | number }).chatId, "12345");
      assert.match(
        (interceptedCall as { text: string }).text,
        /❌ Falha na publicação Zernio — @pedro — motivo: network error/
      );
    } finally {
      Api.prototype.sendMessage = originalSendMessage;
    }
  });
});
