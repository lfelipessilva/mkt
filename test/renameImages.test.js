import test from "node:test";
import assert from "node:assert/strict";
import {
  slugifyDescription,
  shouldSkip,
} from "../src/pipeline/renameImages.js";

test("slugify keeps 2-4 topic words and short length", () => {
  const s = slugifyDescription("Café com pão — elevador!", ".JPG");
  assert.equal(s, "cafe_com_pao_elevador.jpg");
  assert.equal(
    slugifyDescription("skincare autocuidado rotina manhã extra detalhe", ".png"),
    "skincare_autocuidado_rotina_manha.png",
  );
  const long = "a ".repeat(80);
  assert.ok(slugifyDescription(long, ".png").length <= 45 + ".png".length);
});

test("shouldSkip short topics, renames camera and long alt-text", () => {
  assert.equal(shouldSkip("IMG_1234.jpg", false), false);
  assert.equal(shouldSkip("bc78540eedb682e9b8d40102c2dba81e.jpg", false), false);
  assert.equal(shouldSkip("skincare_autocuidado.jpg", false), true);
  assert.equal(shouldSkip("carro_transito_deslocamento.jpg", false), true);
  assert.equal(
    shouldSkip(
      "close_up_vertical_de_uma_bisnaca_de_eucerin_intensive_lip_balm_de_10_ml_sobre_um_tecido_branco_amassado.jpg",
      false,
    ),
    false,
  );
  assert.equal(shouldSkip("skincare_autocuidado.jpg", true), false);
});
