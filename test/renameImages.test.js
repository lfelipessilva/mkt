import test from "node:test";
import assert from "node:assert/strict";
import {
  slugifyDescription,
  shouldSkip,
} from "../src/pipeline/renameImages.js";

test("slugify strips accents and caps length", () => {
  const s = slugifyDescription("Café com pão — elevador!", ".JPG");
  assert.equal(s, "cafe_com_pao_elevador.jpg");
  const long = "a".repeat(250);
  assert.equal(slugifyDescription(long, ".png").length, 200 + ".png".length);
});

test("shouldSkip default vs force", () => {
  assert.equal(shouldSkip("IMG_1234.jpg", false), false);
  assert.equal(shouldSkip("bc78540eedb682e9b8d40102c2dba81e.jpg", false), false);
  assert.equal(
    shouldSkip("casal_jovem_no_espelho_do_elevador_luz_amarela_extra.jpg", false),
    true,
  );
  assert.equal(
    shouldSkip("casal_jovem_no_espelho_do_elevador_luz_amarela_extra.jpg", true),
    false,
  );
});
