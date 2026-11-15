import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  escapeHtml,
  sendCarouselAlbum,
} from "../../src/pipeline/telegram.js";

describe("pipeline: telegram", () => {
  it("escapeHtml escapes HTML entities", () => {
    assert.equal(escapeHtml(`<b>"Tom & Jerry"</b>`), "&lt;b&gt;\"Tom &amp; Jerry\"&lt;/b&gt;");
  });

  it("sendCarouselAlbum sends media group and message with caption", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-telegram-test-"));
    const img1 = path.join(tmpDir, "img1.jpg");
    const img2 = path.join(tmpDir, "img2.jpg");
    fs.writeFileSync(img1, "dummy image 1");
    fs.writeFileSync(img2, "dummy image 2");

    let sentMediaGroup: any = null;
    let sentMessage: any = null;

    const mockApi = {
      sendMediaGroup: async (chatId: any, media: any) => {
        sentMediaGroup = { chatId, media };
        return [];
      },
      sendMessage: async (chatId: any, text: any, opts: any) => {
        sentMessage = { chatId, text, opts };
        return {};
      },
    } as any;

    await sendCarouselAlbum({
      api: mockApi,
      chatId: "123456",
      accountId: "acc_1",
      imagePaths: [img1, img2],
      legenda: "Legenda de teste #dicas #listo",
    });

    assert.ok(sentMediaGroup);
    assert.equal(sentMediaGroup.chatId, "123456");
    assert.equal(sentMediaGroup.media.length, 2);
    assert.equal(sentMediaGroup.media[0].caption, "[acc_1]");
    assert.equal(sentMediaGroup.media[1].caption, undefined);

    assert.ok(sentMessage);
    assert.equal(sentMessage.chatId, "123456");
    assert.ok(sentMessage.text.includes("<code>Legenda de teste #dicas #listo</code>"));
    assert.equal(sentMessage.opts.parse_mode, "HTML");
    assert.ok(sentMessage.opts.reply_markup);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sendCarouselAlbum skips caption message if legenda is empty", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-telegram-test-"));
    const img1 = path.join(tmpDir, "img1.jpg");
    fs.writeFileSync(img1, "dummy");

    let sentMessageCalled = false;
    const mockApi = {
      sendMediaGroup: async () => [],
      sendMessage: async () => {
        sentMessageCalled = true;
        return {};
      },
    } as any;

    await sendCarouselAlbum({
      api: mockApi,
      chatId: "123456",
      accountId: "acc_1",
      imagePaths: [img1],
      legenda: "   ",
    });

    assert.equal(sentMessageCalled, false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
