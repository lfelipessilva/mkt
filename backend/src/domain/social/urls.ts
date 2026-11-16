import path from "node:path";
import { AppError } from "../../shared/errors.js";
import { getSiloConfig, getSiloClient } from "../../shared/storage/silo.js";
import { getOutputDir } from "../media/paths.js";
import type { CarouselRun, CarouselSlide } from "../runs/schemas.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function normalizeSlideKey(slide: CarouselSlide, runOutputDir?: string | null): string {
  let raw = (slide.storage_path || "").trim().replace(/\\/g, "/");

  if (!raw.includes("/") && runOutputDir) {
    raw = path.posix.join(runOutputDir.replace(/\\/g, "/"), raw);
  }

  if (path.isAbsolute(raw)) {
    const outRoot = getOutputDir().replace(/\\/g, "/");
    if (raw.startsWith(outRoot)) {
      raw = path.posix.relative(outRoot, raw);
    } else {
      const outputIndex = raw.lastIndexOf("/output/");
      if (outputIndex !== -1) {
        raw = raw.slice(outputIndex + "/output/".length);
      }
    }
  }

  let cleanKey = raw.replace(/^\/+/, "");

  if (cleanKey.startsWith("output/")) {
    cleanKey = cleanKey.slice("output/".length);
  }

  return cleanKey.replace(/^\/+/, "");
}

export async function resolveCarouselSlidePublicUrls(run: CarouselRun): Promise<string[]> {
  const siloConfig = getSiloConfig();
  if (!siloConfig) {
    throw new AppError("Silo is not configured", 400, "silo_not_configured");
  }

  if (!run.slides || run.slides.length === 0) {
    throw new AppError("Carousel run contains no slides to publish", 400, "no_slides");
  }

  const bucket = process.env.SILO_CAROUSELS_BUCKET || siloConfig.carouselsBucket || "carousels";
  const s3 = getSiloClient();

  const sortedSlides = [...run.slides].sort((a, b) => a.position - b.position);

  const urls: string[] = [];
  for (const slide of sortedSlides) {
    const slideKey = normalizeSlideKey(slide, run.output_dir);
    const command = new GetObjectCommand({ Bucket: bucket, Key: slideKey });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    urls.push(url);
  }
  return urls;
}