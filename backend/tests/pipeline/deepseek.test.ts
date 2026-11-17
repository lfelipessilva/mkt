import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateDeepSeekCopy } from "../../src/pipeline/deepseek.js";
import {
  generateCarouselCopy,
  resolveAIProvider,
  parseJson,
} from "../../src/pipeline/gemini.js";

describe("pipeline: deepseek", () => {
  const sampleSlides = [
    { filename: "capa.jpg" },
    { filename: "foto1.jpg" },
    { filename: "listo_app.jpg", isListo: true },
  ];

  it("throws error when DEEPSEEK_API_KEY is missing", async () => {
    const originalKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      await assert.rejects(
        async () => {
          await generateDeepSeekCopy({
            apiKey: "",
            arquetipoTitulo: "Poupar dinheiro",
            slides: sampleSlides,
          });
        },
        {
          name: "Error",
          message: /DEEPSEEK_API_KEY ausente/,
        }
      );
    } finally {
      if (originalKey) process.env.DEEPSEEK_API_KEY = originalKey;
    }
  });

  it("successfully parses valid response from DeepSeek API", async () => {
    const mockPayload = {
      tema_escolhido: "poupar no mercado",
      slides: [
        { numero: 1, imagem_ref: "capa.jpg", texto: "como economizar no mês" },
        { numero: 2, imagem_ref: "foto1.jpg", texto: "1 - compre itens da estação" },
        { numero: 3, imagem_ref: "listo_app.jpg", texto: "2 - anote tudo em um app de lista" },
      ],
      legenda_tiktok: "dicas práticas pro dia a dia #economia #dicas #compras",
    };

    let fetchCalled = false;
    let requestBody: any = null;

    const mockFetch: typeof fetch = async (url, init) => {
      fetchCalled = true;
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      assert.equal(init?.method, "POST");
      requestBody = JSON.parse(init?.body as string);

      return new Response(
        JSON.stringify({
          id: "cmpl-test",
          object: "chat.completion",
          created: Date.now(),
          model: "deepseek-chat",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify(mockPayload),
              },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const res = await generateDeepSeekCopy({
      apiKey: "sk-test-key",
      arquetipoTitulo: "Poupar dinheiro",
      slides: sampleSlides,
      fetchFn: mockFetch,
    });

    assert.ok(fetchCalled);
    assert.equal(requestBody.model, "deepseek-chat");
    assert.equal(requestBody.response_format.type, "json_object");
    assert.equal(res.tema_escolhido, "poupar no mercado");
    assert.equal(res.slides.length, 3);
    assert.equal(res.slides[0].texto, "como economizar no mês");
    assert.equal(res.legenda_tiktok, mockPayload.legenda_tiktok);
  });

  it("handles markdown code fences in content", async () => {
    const mockPayload = {
      tema_escolhido: "cozinha prática",
      slides: [
        { numero: 1, imagem_ref: "capa.jpg", texto: "cozinhar sem estresse" },
        { numero: 2, imagem_ref: "foto1.jpg", texto: "1 - congele marmitas" },
        { numero: 3, imagem_ref: "listo_app.jpg", texto: "2 - planeje com um app" },
      ],
      legenda_tiktok: "praticidade na rotina #cozinha #marmita #rotina",
    };

    const fencedContent = "```json\n" + JSON.stringify(mockPayload) + "\n```";

    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: fencedContent,
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const res = await generateDeepSeekCopy({
      apiKey: "sk-test-key",
      arquetipoTitulo: "Cozinhar sem estresse",
      slides: sampleSlides,
      fetchFn: mockFetch,
    });

    assert.equal(res.tema_escolhido, "cozinha prática");
    assert.equal(res.slides.length, 3);
  });

  it("retries on 429 and succeeds on next attempt", async () => {
    let callCount = 0;
    const mockPayload = {
      tema_escolhido: "rotina leve",
      slides: [
        { numero: 1, imagem_ref: "capa.jpg", texto: "rotina leve" },
        { numero: 2, imagem_ref: "foto1.jpg", texto: "1 - durma cedo" },
        { numero: 3, imagem_ref: "listo_app.jpg", texto: "2 - organize as compras em um app" },
      ],
      legenda_tiktok: "dicas de bem estar #rotina #paz #vida",
    };

    const mockFetch: typeof fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ error: { message: "Rate limit reached" } }),
          { status: 429, statusText: "Too Many Requests" }
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: JSON.stringify(mockPayload) } }],
        }),
        { status: 200 }
      );
    };

    const res = await generateDeepSeekCopy({
      apiKey: "sk-test-key",
      arquetipoTitulo: "Rotina Leve",
      slides: sampleSlides,
      fetchFn: mockFetch,
    });

    assert.equal(callCount, 2);
    assert.equal(res.tema_escolhido, "rotina leve");
  });

  it("resolveAIProvider chooses deepseek when configured or default", () => {
    assert.equal(resolveAIProvider({ provider: "deepseek" }), "deepseek");
    assert.equal(resolveAIProvider({ provider: "gemini" }), "gemini");
    assert.equal(resolveAIProvider({ model: "deepseek-chat" }), "deepseek");
    assert.equal(resolveAIProvider({ model: "gemini-2.5-flash" }), "gemini");
  });

  it("parseJson handles json embedded in text", () => {
    const raw = `Here is your JSON response:
    {
      "tema_escolhido": "organização",
      "slides": [],
      "legenda_tiktok": "legend"
    }
    Hope this helps!`;
    const parsed = parseJson(raw);
    assert.equal(parsed.tema_escolhido, "organização");
  });
});
