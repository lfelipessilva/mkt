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

  afterEach(() => {
    if (prevNotify === undefined) delete process.env.TELEGRAM_NOTIFY_CHAT_ID;
    else process.env.TELEGRAM_NOTIFY_CHAT_ID = prevNotify;
    if (prevChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = prevChat;
    if (prevBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = prevBase;
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
      `approve_buffer:${runId}`
    );

    const withUrl = buildApprovalKeyboard(runId, "https://app.example.com");
    assert.equal(withUrl.inline_keyboard[0].length, 2);
    assert.equal(withUrl.inline_keyboard[0][0].text, "🔗 Abrir carrossel");
    assert.equal(
      withUrl.inline_keyboard[0][0].url,
      `https://app.example.com/?tab=galeria&run=${runId}`
    );
    assert.equal(withUrl.inline_keyboard[0][1].callback_data, `approve_buffer:${runId}`);
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
        expect: /❌ Falha ao gerar — @gabriel — timeout/,
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
        payload: { account: "gabriel" },
        expect: /📤 No Buffer em ~30min — @gabriel — abre o Buffer, adiciona a música e publica/,
      },
      {
        event: "publish_ok",
        payload: { account: "gabriel", archetype: "Foco" },
        expect: /✅ Publicado no TikTok — @gabriel — arquétipo: Foco/,
      },
      {
        event: "publish_failed",
        payload: { account: "gabriel", reason: "denied" },
        expect: /❌ Falha na publicação — @gabriel — denied/,
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
});
