import { existsSync, renameSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import sharp from "sharp";
import { listImages } from "./select.js";

const CAMERA_RE = /^(IMG|DSC|PXL|DSCN|MVIMG)[_-]?\d+/i;
const DIGITS_RE = /^\d{6,}$/;
const PROMPT =
  "Descreva esta imagem em português, de forma detalhada (~150 a 200 caracteres). " +
  "Responda só com a descrição, sem aspas e sem pontuação final.";

export function slugifyDescription(text, ext) {
  const rawExt = (ext || "").startsWith(".") ? ext : `.${ext || "jpg"}`;
  const stem = String(text || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 200);
  return `${stem || "imagem"}${rawExt.toLowerCase()}`;
}

export function isCameraLike(stem) {
  return CAMERA_RE.test(stem) || DIGITS_RE.test(stem);
}

export function shouldSkip(filename, force = false) {
  if (force) return false;
  const stem = basename(filename, extname(filename));
  if (isCameraLike(stem)) return false;
  return stem.length >= 40;
}

export function uniquePath(dir, filename) {
  let candidate = join(dir, filename);
  if (!existsSync(candidate)) return candidate;
  const ext = extname(filename);
  const stem = basename(filename, ext);
  for (let i = 2; i < 1000; i++) {
    candidate = join(dir, `${stem}_${i}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`não achou nome livre pra ${filename}`);
}

async function shrinkJpeg(imagePath) {
  const img = sharp(imagePath);
  const meta = await img.metadata();
  const width = Math.max(1, Math.round((meta.width || 1) / 3));
  const height = Math.max(1, Math.round((meta.height || 1) / 3));
  return img.resize({ width, height }).jpeg({ quality: 80 }).toBuffer();
}

async function describeOnce(model, buffer) {
  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: buffer.toString("base64"),
      },
    },
    { text: PROMPT },
  ]);
  const text = result.response.text()?.trim();
  if (!text) throw new Error("gemini retornou descrição vazia");
  return text;
}

export async function describeImage({ apiKey, model, imagePath }) {
  if (!apiKey) throw new Error("GEMINI_API_KEY ausente");
  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({ model });
  const buffer = await shrinkJpeg(imagePath);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await describeOnce(generativeModel, buffer);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export async function runRenameImages({
  mediaDirs,
  apiKey,
  model,
  force = false,
}) {
  const dirs = [mediaDirs.capas, mediaDirs.aleatorias, mediaDirs.listo].filter(
    Boolean,
  );
  const renamed = [];
  const skipped = [];
  const errors = [];

  for (const dir of dirs) {
    const images = listImages(dir);
    for (const img of images) {
      if (shouldSkip(img.filename, force)) {
        skipped.push({ file: img.filename, reason: "already_descriptive" });
        continue;
      }
      try {
        const description = await describeImage({
          apiKey,
          model,
          imagePath: img.path,
        });
        const nextName = slugifyDescription(
          description,
          extname(img.filename) || ".jpg",
        );
        const dest = uniquePath(dirname(img.path), nextName);
        const to = basename(dest);
        if (to === img.filename) {
          skipped.push({ file: img.filename, reason: "unchanged" });
          continue;
        }
        renameSync(img.path, dest);
        renamed.push({
          from: img.filename,
          to,
          dir: basename(dir),
        });
      } catch (e) {
        errors.push({ file: img.filename, message: e.message });
      }
    }
  }

  return {
    renamed,
    skipped,
    errors,
    summary: `renamed=${renamed.length} skipped=${skipped.length} errors=${errors.length}`,
  };
}
