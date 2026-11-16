import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolveCarouselSlidePublicUrls } from "../../src/domain/social/urls.js";
import { AppError } from "../../src/shared/errors.js";
import type { CarouselRun } from "../../src/domain/runs/schemas.js";

describe("resolveCarouselSlidePublicUrls", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SILO_SERVER_URL = "https://personal-minio.adaygq.easypanel.host";
    process.env.SILO_CAROUSELS_BUCKET = "carousels";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("given a run with slides sorted by position (1, 2, 3), returns array of public URLs", () => {
    const run: CarouselRun = {
      id: "11111111-1111-1111-1111-111111111111",
      account_id: "gabriel",
      account_role: "single_man",
      archetype_title: "Test Archetype",
      legenda: "Test caption",
      status: "generated",
      output_dir: "/path/to/output/2026-11-15/gabriel/post_1",
      slides: [
        {
          id: "slide-3",
          run_id: "11111111-1111-1111-1111-111111111111",
          position: 3,
          storage_path: "/path/to/output/2026-11-15/gabriel/post_1/slide_3.jpg",
        },
        {
          id: "slide-1",
          run_id: "11111111-1111-1111-1111-111111111111",
          position: 1,
          storage_path: "/path/to/output/2026-11-15/gabriel/post_1/slide_1.jpg",
        },
        {
          id: "slide-2",
          run_id: "11111111-1111-1111-1111-111111111111",
          position: 2,
          storage_path: "/path/to/output/2026-11-15/gabriel/post_1/slide_2.jpg",
        },
      ],
    };

    const urls = resolveCarouselSlidePublicUrls(run);

    assert.deepEqual(urls, [
      "https://personal-minio.adaygq.easypanel.host/carousels/2026-11-15/gabriel/post_1/slide_1.jpg",
      "https://personal-minio.adaygq.easypanel.host/carousels/2026-11-15/gabriel/post_1/slide_2.jpg",
      "https://personal-minio.adaygq.easypanel.host/carousels/2026-11-15/gabriel/post_1/slide_3.jpg",
    ]);
  });

  it("extracts relative path when storage_path contains output/ prefix", () => {
    const run: CarouselRun = {
      id: "22222222-2222-2222-2222-222222222222",
      account_id: "lucas",
      account_role: "couple_men",
      archetype_title: "Test",
      legenda: "Legenda",
      status: "generated",
      slides: [
        {
          id: "s1",
          run_id: "22222222-2222-2222-2222-222222222222",
          position: 1,
          storage_path: "output/2026-11-15/lucas/post_2/slide_1.jpg",
        },
      ],
    };

    const urls = resolveCarouselSlidePublicUrls(run);
    assert.deepEqual(urls, [
      "https://personal-minio.adaygq.easypanel.host/carousels/2026-11-15/lucas/post_2/slide_1.jpg",
    ]);
  });

  it("derives slide key from output_dir and position if storage_path is just slide filename or basename", () => {
    const run: CarouselRun = {
      id: "33333333-3333-3333-3333-333333333333",
      account_id: "ana",
      account_role: "single_woman",
      archetype_title: "Test",
      legenda: "Legenda",
      status: "generated",
      output_dir: "output/2026-11-15/ana/post_1",
      slides: [
        {
          id: "s1",
          run_id: "33333333-3333-3333-3333-333333333333",
          position: 1,
          storage_path: "slide_1.jpg",
        },
      ],
    };

    const urls = resolveCarouselSlidePublicUrls(run);
    assert.deepEqual(urls, [
      "https://personal-minio.adaygq.easypanel.host/carousels/2026-11-15/ana/post_1/slide_1.jpg",
    ]);
  });

  it("throws AppError('silo_not_configured', 400) if SILO_SERVER_URL is absent or empty", () => {
    delete process.env.SILO_SERVER_URL;

    const run: CarouselRun = {
      id: "44444444-4444-4444-4444-444444444444",
      account_id: "gabriel",
      account_role: "single_man",
      archetype_title: "Test",
      legenda: "Legenda",
      status: "generated",
      slides: [
        {
          id: "s1",
          run_id: "44444444-4444-4444-4444-444444444444",
          position: 1,
          storage_path: "output/2026-11-15/gabriel/post_1/slide_1.jpg",
        },
      ],
    };

    assert.throws(
      () => resolveCarouselSlidePublicUrls(run),
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.code, "silo_not_configured");
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  it("throws AppError('no_slides', 400) if run has 0 slides or undefined slides", () => {
    const runWithoutSlides: CarouselRun = {
      id: "55555555-5555-5555-5555-555555555555",
      account_id: "gabriel",
      account_role: "single_man",
      archetype_title: "Test",
      legenda: "Legenda",
      status: "generated",
    };

    assert.throws(
      () => resolveCarouselSlidePublicUrls(runWithoutSlides),
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.code, "no_slides");
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    const runWithEmptySlides: CarouselRun = {
      ...runWithoutSlides,
      slides: [],
    };

    assert.throws(
      () => resolveCarouselSlidePublicUrls(runWithEmptySlides),
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.code, "no_slides");
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });
});
