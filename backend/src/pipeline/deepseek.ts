import {
  SYSTEM_INSTRUCTION,
  buildUserPrompt,
  type PromptSlideItem,
} from "./prompts.js";
import { parseJson, type GeneratedCarouselCopy } from "./gemini.js";

export interface GenerateDeepSeekCopyOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  persona?: string;
  arquetipoTitulo: string;
  baitTrigger?: string | null;
  slides: PromptSlideItem[];
  fetchFn?: typeof fetch;
  temperature?: number;
}

export async function generateDeepSeekCopy({
  apiKey = process.env.DEEPSEEK_API_KEY || "",
  model = process.env.DEEPSEEK_MODEL || "deepseek-chat",
  baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  persona = "",
  arquetipoTitulo,
  baitTrigger,
  slides,
  fetchFn = globalThis.fetch,
  temperature = 0.85,
}: GenerateDeepSeekCopyOptions): Promise<GeneratedCarouselCopy> {
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY ausente. Adicione DEEPSEEK_API_KEY ao .env ou passe como parâmetro."
    );
  }

  const endpoint = `${baseURL.replace(/\/+$/, "")}/chat/completions`;

  const prompt = buildUserPrompt({
    persona,
    arquetipoTitulo,
    baitTrigger,
    slides: slides.map((s) => ({
      filename: s.filename,
      isListo: s.isListo,
    })),
  });

  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content: SYSTEM_INSTRUCTION,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    response_format: {
      type: "json_object",
    },
    temperature,
  };

  let lastError: unknown;
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = errorText;
        try {
          const parsed = JSON.parse(errorText);
          errorMessage = parsed?.error?.message || errorText;
        } catch {
          // keep errorText
        }

        const err: any = new Error(
          `[DeepSeek Error]: Error fetching from ${endpoint}: [${response.status} ${response.statusText}] ${errorMessage}`
        );
        err.status = response.status;
        throw err;
      }

      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new Error("DeepSeek retornou resposta vazia ou sem choices[0].message.content");
      }

      const data = parseJson<GeneratedCarouselCopy>(content);

      if (!Array.isArray(data.slides) || data.slides.length !== slides.length) {
        throw new Error(
          `DeepSeek retornou ${data.slides?.length ?? 0} slides, esperado ${slides.length}`
        );
      }

      // Normaliza possíveis campos ausentes nos slides
      data.slides = data.slides.map((s, idx) => ({
        numero: typeof s.numero === "number" ? s.numero : idx + 1,
        imagem_ref: s.imagem_ref || slides[idx]?.filename || "",
        texto: s.texto || "",
      }));

      return data;
    } catch (e: any) {
      lastError = e;
      const status = e?.status;
      const isRetriable =
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        e?.name === "TimeoutError" ||
        e?.name === "AbortError";

      if (attempt < maxAttempts - 1 && (isRetriable || attempt === 0)) {
        const waitMs = isRetriable ? 2000 * (attempt + 1) : 500;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!isRetriable && attempt > 0) {
        throw lastError;
      }
    }
  }

  throw lastError;
}
