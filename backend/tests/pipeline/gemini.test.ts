import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SchemaType } from "@google/generative-ai";
import {
  toGeminiSchema,
  parseJson,
} from "../../src/pipeline/gemini.js";
import {
  buildUserPrompt,
  cleanVisualTopic,
  RESPONSE_SCHEMA,
} from "../../src/pipeline/prompts.js";

describe("pipeline: gemini & prompts", () => {
  it("cleanVisualTopic formats filenames properly", () => {
    assert.equal(cleanVisualTopic("mercado_compras_01.jpg"), "mercado compras");
    assert.equal(cleanVisualTopic("sala_estar.png"), "sala estar");
  });

  it("buildUserPrompt builds prompt with persona, capa, bait and slide tags", () => {
    const prompt = buildUserPrompt({
      persona: "Jovem solteira",
      arquetipoTitulo: "Como poupar no mercado",
      baitTrigger: "Dica secreta no final",
      slides: [
        { filename: "capa.jpg" },
        { filename: "mercado_01.jpg" },
        { filename: "app_listo_01.jpg", isListo: true },
      ],
    });

    assert.ok(prompt.includes("PERSONA: Jovem solteira"));
    assert.ok(prompt.includes("TÍTULO DA CAPA (reescreva mantendo exatamente a mesma ideia): Como poupar no mercado"));
    assert.ok(prompt.includes("BAIT PARA INSERIR EM UM DOS SLIDES ALEATÓRIOS (encaixe apenas onde fizer sentido natural): Dica secreta no final"));
    assert.ok(prompt.includes("Slide 1 (Capa)"));
    assert.ok(prompt.includes("Slide 2 [ALEATORIA]"));
    assert.ok(prompt.includes("Slide 3 [APP LISTO]"));
  });

  it("buildUserPrompt formats prompt when without bait", () => {
    const prompt = buildUserPrompt({
      persona: "Casal jovem",
      arquetipoTitulo: "Rotina a dois",
      slides: [{ filename: "capa.jpg" }],
    });

    assert.ok(prompt.includes("SEM BAIT NESTE POST"));
  });

  it("toGeminiSchema converts json schema definition to Gemini schema", () => {
    const schema = toGeminiSchema(RESPONSE_SCHEMA as any);
    assert.equal(schema.type, SchemaType.OBJECT);
    assert.ok(schema.properties);
    assert.equal(schema.properties.tema_escolhido.type, SchemaType.STRING);
    assert.equal(schema.properties.slides.type, SchemaType.ARRAY);
  });

  it("parseJson handles plain JSON and markdown-fenced JSON", () => {
    const plain = '{"tema": "economia"}';
    assert.deepEqual(parseJson(plain), { tema: "economia" });

    const fenced = '```json\n{"tema": "economia"}\n```';
    assert.deepEqual(parseJson(fenced), { tema: "economia" });
  });
});
