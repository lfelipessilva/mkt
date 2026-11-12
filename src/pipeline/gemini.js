import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import {
  SYSTEM_INSTRUCTION,
  buildUserPrompt,
  RESPONSE_SCHEMA,
} from "../../config/prompts.js";

function toGeminiSchema(schema) {
  if (schema.type === "object") {
    const properties = {};
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
      items: toGeminiSchema(schema.items),
    };
  }
  if (schema.type === "integer") return { type: SchemaType.INTEGER };
  return { type: SchemaType.STRING };
}

function parseJson(text) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

export async function generateCarouselCopy({
  apiKey,
  model,
  persona,
  arquetipoTitulo,
  slides,
}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY ausente");

  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({
    model,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(RESPONSE_SCHEMA),
      temperature: 0.7,
    },
  });

  const prompt = buildUserPrompt({
    persona,
    arquetipoTitulo,
    slides: slides.map((s) => ({
      filename: s.filename,
      isListo: s.isListo,
    })),
  });

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await generativeModel.generateContent(prompt);
      const text = result.response.text();
      const data = parseJson(text);
      if (!Array.isArray(data.slides) || data.slides.length !== slides.length) {
        throw new Error(`gemini retornou ${data.slides?.length ?? 0} slides, esperado ${slides.length}`);
      }
      return data;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
