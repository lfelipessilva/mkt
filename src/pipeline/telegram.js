import { InputFile, InputMediaBuilder } from "grammy";

const CAPTION_LIMIT = 1024;

export async function sendCarouselAlbum({
  api,
  chatId,
  accountId,
  imagePaths,
  legenda,
}) {
  const caption = `[${accountId}]\n${legenda || ""}`.trim();
  const useCaption = caption.length <= CAPTION_LIMIT ? caption : `[${accountId}]`;

  const media = imagePaths.map((path, i) =>
    InputMediaBuilder.photo(
      new InputFile(path),
      i === 0 ? { caption: useCaption } : undefined,
    ),
  );

  await api.sendMediaGroup(chatId, media);

  if (caption.length > CAPTION_LIMIT) {
    await api.sendMessage(chatId, caption);
  }
}
