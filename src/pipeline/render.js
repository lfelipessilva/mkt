import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const W = 1080;
const H = 1920;

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wrapWords(text, maxChars = 26) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

// Estima largura visual da linha para ajustar o pill branco perfeitamente
function estimateLineWidth(line, fontSize) {
  let width = 0;
  for (const ch of line) {
    if ("ilíìîï1.,!|:; ".includes(ch)) width += fontSize * 0.32;
    else if ("mwMW@".includes(ch)) width += fontSize * 0.82;
    else width += fontSize * 0.54;
  }
  return Math.max(width, fontSize * 1.5);
}

/**
 * style: "pill" (caixa branca nativa do TikTok) | "outline" (texto branco com contorno suave)
 */
function textSvg(text, style = "pill") {
  const lines = wrapWords(text, 26);
  const fontSize = lines.some((l) => l.length > 26) ? 48 : 52;

  // Abaixo da UI do topo (busca/status) e do crop do iPad; acima da legenda inferior
  const randomOffsetY = (Math.random() - 0.5) * 90;
  const randomAngle = (Math.random() - 0.5) * 1.3;
  const anchorY = style === "pill" ? H * 0.32 : H * 0.42;

  if (style === "pill") {
    const lineHeight = fontSize * 1.42;
    const blockHeight = lines.length * lineHeight;
    const startY = anchorY - blockHeight / 2 + randomOffsetY;
    const padX = 26;
    const padY = 12;
    const boxHeight = fontSize + padY * 2;

    const elements = lines
      .map((line, i) => {
        const textWidth = estimateLineWidth(line, fontSize);
        const boxWidth = textWidth + padX * 2;
        const boxX = 540 - boxWidth / 2;
        const textY = startY + i * lineHeight;
        const boxY = textY - fontSize * 0.82 - padY;

        return `
          <rect x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="${boxWidth.toFixed(1)}" height="${boxHeight.toFixed(1)}" rx="16" ry="16" fill="#ffffff" />
          <text x="540" y="${textY.toFixed(1)}" class="t-pill">${escapeXml(line)}</text>
        `;
      })
      .join("");

    return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="softShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.22"/>
    </filter>
  </defs>
  <style>
    .t-pill {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", "Inter", Arial, sans-serif;
      font-size: ${fontSize}px;
      font-weight: 700;
      letter-spacing: -0.5px;
      fill: #111111;
      text-anchor: middle;
    }
  </style>
  <g transform="rotate(${randomAngle.toFixed(2)} 540 ${anchorY.toFixed(0)})" filter="url(#softShadow)">
    ${elements}
  </g>
</svg>`);
  }

  const lineHeight = fontSize * 1.28;
  const blockHeight = lines.length * lineHeight;
  const startY = anchorY - blockHeight / 2 + randomOffsetY;

  const tspans = lines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      return `<tspan x="540" y="${y.toFixed(1)}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="textShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <style>
    .t-outline {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", "Inter", Arial, sans-serif;
      font-size: ${fontSize}px;
      font-weight: 700;
      letter-spacing: -0.4px;
      fill: #ffffff;
      stroke: #000000;
      stroke-width: 7px;
      stroke-linejoin: round;
      stroke-linecap: round;
      paint-order: stroke fill;
      text-anchor: middle;
    }
  </style>
  <g transform="rotate(${randomAngle.toFixed(2)} 540 ${anchorY.toFixed(0)})" filter="url(#textShadow)">
    <text class="t-outline">${tspans}</text>
  </g>
</svg>`);
}

export async function renderSlide({ imagePath, text, outPath, style = "pill" }) {
  const zoom = 1.02;
  const rw = Math.ceil(W * zoom);
  const rh = Math.ceil(H * zoom);
  const left = Math.floor(Math.random() * (rw - W + 1));
  const top = Math.floor(Math.random() * (rh - H + 1));
  const overlay = textSvg(text, style);

  await sharp(imagePath)
    .rotate()
    .resize(rw, rh, { fit: "cover", position: "centre" })
    .extract({ left, top, width: W, height: H })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(outPath);

  return outPath;
}

export async function renderCarousel({ slides, textsByNumero, outDir }) {
  mkdirSync(outDir, { recursive: true });
  // Alterna o estilo visual por carrossel (70% caixa branca nativa, 30% contorno limpo)
  const carouselStyle = Math.random() > 0.3 ? "pill" : "outline";

  const paths = [];
  for (const slide of slides) {
    const text =
      textsByNumero.get(slide.numero) ??
      textsByNumero.get(String(slide.numero)) ??
      "";
    const outPath = join(outDir, `slide_${slide.numero}.jpg`);
    await renderSlide({ imagePath: slide.path, text, outPath, style: carouselStyle });
    paths.push(outPath);
  }
  return paths;
}

