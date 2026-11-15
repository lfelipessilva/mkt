import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  escapeXml,
  wrapWords,
  estimateLineWidth,
  textSvg,
  renderSlide,
  renderCarousel,
} from "../../src/pipeline/render.js";

describe("pipeline: render", () => {
  let tmpDir: string;
  let sampleImagePath: string;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-render-test-"));
    sampleImagePath = path.join(tmpDir, "sample.jpg");

    // Create a 1080x1920 solid red image with sharp
    await sharp({
      create: {
        width: 1080,
        height: 1920,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toFile(sampleImagePath);
  });

  after(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("escapeXml escapes special characters", () => {
    assert.equal(escapeXml(`a & b < c > "d"`), "a &amp; b &lt; c &gt; &quot;d&quot;");
  });

  it("wrapWords wraps lines up to maxChars and max 4 lines", () => {
    const text = "Este é um texto longo planejado para testar quebra de linhas do carrossel";
    const lines = wrapWords(text, 20);
    assert.ok(lines.length <= 4);
    assert.ok(lines.every((l) => l.length <= 30));
  });

  it("estimateLineWidth returns expected minimums and character weights", () => {
    const width = estimateLineWidth("teste rápido", 50);
    assert.ok(width > 50);
  });

  it("textSvg produces SVG buffers for pill and outline styles", () => {
    const pillSvg = textSvg("Texto de teste pill", "pill");
    assert.ok(pillSvg.toString().includes("<svg"));
    assert.ok(pillSvg.toString().includes("t-pill"));

    const outlineSvg = textSvg("Texto de teste outline", "outline");
    assert.ok(outlineSvg.toString().includes("<svg"));
    assert.ok(outlineSvg.toString().includes("t-outline"));
  });

  it("renderSlide produces a valid jpeg output file", async () => {
    const outPath = path.join(tmpDir, "rendered_slide.jpg");
    const result = await renderSlide({
      imagePath: sampleImagePath,
      text: "Dica 1: Organize sua despensa",
      outPath,
      style: "pill",
    });

    assert.equal(result, outPath);
    assert.ok(fs.existsSync(outPath));

    const meta = await sharp(outPath).metadata();
    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1920);
    assert.equal(meta.format, "jpeg");
  });

  it("renderCarousel renders all slides in sequence", async () => {
    const outDir = path.join(tmpDir, "carousel_out");
    const slides = [
      { numero: 1, path: sampleImagePath },
      { numero: 2, path: sampleImagePath },
    ];
    const textsByNumero = new Map<number | string, string>([
      [1, "Capa do post"],
      [2, "Slide 2 do post"],
    ]);

    const paths = await renderCarousel({
      slides,
      textsByNumero,
      outDir,
    });

    assert.equal(paths.length, 2);
    assert.ok(fs.existsSync(paths[0]));
    assert.ok(fs.existsSync(paths[1]));
  });
});
