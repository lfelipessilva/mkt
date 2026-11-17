import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";
import {
  SYSTEM_INSTRUCTION,
  buildUserPrompt,
  RESPONSE_SCHEMA,
  type PromptSlideItem,
} from "./prompts.js";
import { generateDeepSeekCopy } from "./deepseek.js";

export type AIProvider = "deepseek" | "gemini";

export interface SchemaDefinition {
  type: string;
  properties?: Record<string, SchemaDefinition>;
  items?: SchemaDefinition;
  required?: string[];
}

export function toGeminiSchema(schema: SchemaDefinition): ResponseSchema {
  if (schema.type === "object") {
    const properties: Record<string, ResponseSchema> = {};
    for (const [k, v] of Object.entries(schema.properties || {})) {
      properties[k] = toGeminiSchema(v);
    }
    return {
      type: SchemaType.OBJECT,
      properties,
      required: schema.required,
    };
  }
  if (schema.type === "array") {
    return {
      type: SchemaType.ARRAY,
      items: schema.items ? toGeminiSchema(schema.items) : { type: SchemaType.STRING },
    };
  }
  if (schema.type === "integer") return { type: SchemaType.INTEGER };
  return { type: SchemaType.STRING };
}

export function parseJson<T = any>(text: string): T {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/i, "");
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.replace(/```$/i, "");
  }
  cleaned = cleaned.trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

export interface GeneratedSlideCopy {
  numero: number;
  imagem_ref: string;
  texto: string;
}

export interface GeneratedCarouselCopy {
  tema_escolhido: string;
  slides: GeneratedSlideCopy[];
  legenda_tiktok: string;
}

export interface GenerateCarouselCopyOptions {
  provider?: AIProvider;
  apiKey?: string;
  model?: string;
  persona?: string;
  arquetipoTitulo: string;
  baitTrigger?: string | null;
  slides: PromptSlideItem[];
}

export function resolveAIProvider(options?: {
  provider?: AIProvider;
  model?: string;
  apiKey?: string;
}): AIProvider {
  if (options?.provider) return options.provider;

  if (options?.model?.toLowerCase().startsWith("gemini")) return "gemini";
  if (options?.model?.toLowerCase().startsWith("deepseek")) return "deepseek";

  const envProvider = (process.env.AI_PROVIDER || "").toLowerCase().trim();
  if (envProvider === "deepseek") return "deepseek";
  if (envProvider === "gemini") return "gemini";

  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.GEMINI_API_KEY) return "gemini";

  return "deepseek";
}

export async function generateGeminiCopy({
  apiKey = process.env.GEMINI_API_KEY || "",
  model = process.env.GEMINI_MODEL || "gemini-2.5-flash",
  persona = "",
  arquetipoTitulo,
  baitTrigger,
  slides,
}: GenerateCarouselCopyOptions): Promise<GeneratedCarouselCopy> {
  if (!apiKey) throw new Error("GEMINI_API_KEY ausente");

  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({
    model,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(RESPONSE_SCHEMA as SchemaDefinition),
      temperature: 0.85,
    },
  });

  const prompt = buildUserPrompt({
    persona,
    arquetipoTitulo,
    baitTrigger,
    slides: slides.map((s) => ({
      filename: s.filename,
      isListo: s.isListo,
    })),
  });

  let lastError: unknown;
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await generativeModel.generateContent(prompt);
      const text = result.response.text();
      const data = parseJson<GeneratedCarouselCopy>(text);
      if (!Array.isArray(data.slides) || data.slides.length !== slides.length) {
        throw new Error(
          `gemini retornou ${data.slides?.length ?? 0} slides, esperado ${slides.length}`
        );
      }
      return data;
    } catch (e: any) {
      lastError = e;
      const status = e?.status;
      const retriable = status === 503 || status === 429 || status === 500;
      if (attempt < maxAttempts - 1 && (retriable || attempt === 0)) {
        const waitMs = retriable ? 3000 * (attempt + 1) : 500;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!retriable && attempt > 0) {
        throw lastError;
      }
    }
  }
  throw lastError;
}

export async function generateCarouselCopy(
  options: GenerateCarouselCopyOptions
): Promise<GeneratedCarouselCopy> {
  const provider = resolveAIProvider(options);

  if (provider === "deepseek") {
    return generateDeepSeekCopy({
      apiKey: options.apiKey || process.env.DEEPSEEK_API_KEY,
      model: options.model || process.env.DEEPSEEK_MODEL || "deepseek-chat",
      persona: options.persona,
      arquetipoTitulo: options.arquetipoTitulo,
      baitTrigger: options.baitTrigger,
      slides: options.slides,
    });
  }

  return generateGeminiCopy({
    ...options,
    apiKey: options.apiKey || process.env.GEMINI_API_KEY,
    model: options.model || process.env.GEMINI_MODEL || "gemini-2.5-flash",
  });
}
