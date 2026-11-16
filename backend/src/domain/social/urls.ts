import path from "node:path";
import { AppError } from "../../shared/errors.js";
import { getSiloConfig } from "../../shared/storage/silo.js";
import { getOutputDir } from "../media/paths.js";
import type { CarouselRun, CarouselSlide } from "../runs/schemas.js";

/**
 * Normalizes a slide storage path into a relative key inside the Silo carousels bucket.
 * For example:
 * - "/abs/path/to/output/2026-11-15/gabriel/post_1/slide_1.jpg" -> "2026-11-15/gabriel/post_1/slide_1.jpg"
 * - "output/2026-11-15/gabriel/post_1/slide_1.jpg" -> "2026-11-15/gabriel/post_1/slide_1.jpg"
 * - "slide_1.jpg" with output_dir "/.../2026-11-15/gabriel/post_1" -> "2026-11-15/gabriel/post_1/slide_1.jpg"
 */
function normalizeSlideKey(slide: CarouselSlide, runOutputDir?: string | null): string {
  let raw = (slide.storage_path || "").trim().replace(/\\/g, "/");

  // If storage path is just a file name (e.g. "slide_1.jpg"), join with runOutputDir if available
  if (!raw.includes("/") && runOutputDir) {
    raw = path.posix.join(runOutputDir.replace(/\\/g, "/"), raw);
  }

  // If it's an absolute path, compute relative to output directory root
  if (path.isAbsolute(raw)) {
    const outRoot = getOutputDir().replace(/\\/g, "/");
    if (raw.startsWith(outRoot)) {
      raw = path.posix.relative(outRoot, raw);
    } else {
      // If raw contains "/output/", extract everything after the last "/output/"
      const outputIndex = raw.lastIndexOf("/output/");
      if (outputIndex !== -1) {
        raw = raw.slice(outputIndex + "/output/".length);
      }
    }
  }

  // Remove leading slashes
  let cleanKey = raw.replace(/^\/+/, "");

  // Remove leading "output/" if present
  if (cleanKey.startsWith("output/")) {
    cleanKey = cleanKey.slice("output/".length);
  }

  return cleanKey.replace(/^\/+/, "");
}

/**
 * Resolves the public Silo HTTPS URLs for all slides in a CarouselRun.
 *
 * Requirements:
 * - Silo must be configured (SILO_SERVER_URL).
 * - Run must contain at least 1 slide.
 * - Slides are sorted by position ascending.
 * - URLs are constructed as: `${siloServerUrl}/${carouselsBucket}/${cleanKey}`
 *
 * @throws AppError('silo_not_configured', 400) if SILO_SERVER_URL is missing.
 * @throws AppError('no_slides', 400) if run has no slides.
 */
export function resolveCarouselSlidePublicUrls(run: CarouselRun): string[] {
  const siloServerUrl = process.env.SILO_SERVER_URL?.trim().replace(/\/+$/, "");
  if (!siloServerUrl) {
    throw new AppError("Silo server URL is not configured", 400, "silo_not_configured");
  }

  if (!run.slides || run.slides.length === 0) {
    throw new AppError("Carousel run contains no slides to publish", 400, "no_slides");
  }

  const siloConfig = getSiloConfig();
  const bucket = process.env.SILO_CAROUSELS_BUCKET || siloConfig?.carouselsBucket || "carousels";

  // Sort slides by position ascending
  const sortedSlides = [...run.slides].sort((a, b) => a.position - b.position);

  return sortedSlides.map((slide) => {
    const slideKey = normalizeSlideKey(slide, run.output_dir);
    return `${siloServerUrl}/${bucket}/${slideKey}`;
  });
}
