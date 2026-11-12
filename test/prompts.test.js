import test from "node:test";
import assert from "node:assert/strict";
import { buildUserPrompt, cleanVisualTopic } from "../config/prompts.js";

test("cleanVisualTopic strips extension and numeric suffix", () => {
  assert.equal(cleanVisualTopic("skincare_autocuidado_14.jpg"), "skincare autocuidado");
  assert.equal(cleanVisualTopic("viagem_aeroporto.png"), "viagem aeroporto");
});

test("buildUserPrompt keeps arquivo raw and sends cleaned tema_visual", () => {
  const prompt = buildUserPrompt({
    persona: "casal",
    arquetipoTitulo: "cortar desperdício",
    baitTrigger: "a teoria do prato quente",
    slides: [
      { filename: "viagem_aeroporto.jpg", isListo: false },
      { filename: "app_lista_2.png", isListo: true },
    ],
  });
  assert.match(prompt, /TODOS os itens respondem diretamente ao título da capa/);
  assert.match(
    prompt,
    /Slide 1 \(Capa\): arquivo="viagem_aeroporto\.jpg" \| tema_visual="viagem aeroporto"/,
  );
  assert.match(
    prompt,
    /Slide 2 \[APP LISTO\]: arquivo="app_lista_2\.png" \| tema_visual="app lista"/,
  );
  assert.doesNotMatch(prompt, /cada texto DEVE falar sobre o elemento principal/);
});
