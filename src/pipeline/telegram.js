import { InputFile, InputMediaBuilder, InlineKeyboard } from "grammy";

const COPY_TEXT_LIMIT = 256;

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function sendCarouselAlbum({
  api,
  chatId,
  accountId,
  imagePaths,
  legenda,
}) {
  const media = imagePaths.map((path, i) =>
    InputMediaBuilder.photo(
      new InputFile(path),
      i === 0 ? { caption: `[${accountId}]` } : undefined,
    ),
  );

  await api.sendMediaGroup(chatId, media);

  const text = (legenda || "").trim();
  if (!text) return;

  const opts = { parse_mode: "HTML" };
  if (text.length <= COPY_TEXT_LIMIT) {
    opts.reply_markup = new InlineKeyboard().copyText("Copiar legenda", text);
  }

  await api.sendMessage(chatId, `<code>${escapeHtml(text)}</code>`, opts);
}
