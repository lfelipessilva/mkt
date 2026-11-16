import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CarouselSlide } from "./types";
import {
  resolveCoverSlide,
  formatCollapsedSlideCountBadge,
  formatCardMetrics,
} from "./components/RunCard";

describe("RunCard compact helpers (Issue #3)", () => {
  it("resolves cover slide correctly when slide position 1 exists", () => {
    const slides: CarouselSlide[] = [
      { id: "s3", run_id: "r1", position: 3, storage_path: "p3.jpg" },
      { id: "s1", run_id: "r1", position: 1, storage_path: "p1.jpg" },
      { id: "s2", run_id: "r1", position: 2, storage_path: "p2.jpg" },
    ];
    const cover = resolveCoverSlide(slides);
    assert.ok(cover);
    assert.equal(cover?.id, "s1");
    assert.equal(cover?.position, 1);
  });

  it("resolves first slide if position 1 is not found, or null if empty", () => {
    assert.equal(resolveCoverSlide([]), null);
    const slides: CarouselSlide[] = [
      { id: "s2", run_id: "r1", position: 2, storage_path: "p2.jpg" },
    ];
    const cover = resolveCoverSlide(slides);
    assert.equal(cover?.id, "s2");
  });

  it("formats collapsed slide count badge correctly", () => {
    assert.equal(formatCollapsedSlideCountBadge(0), "Sem slides");
    assert.equal(formatCollapsedSlideCountBadge(1), "1 slide");
    assert.equal(formatCollapsedSlideCountBadge(4), "4 slides");
    assert.equal(formatCollapsedSlideCountBadge(10), "10 slides");
  });

  it("formats metrics chips properly when provided", () => {
    const formatted = formatCardMetrics({
      views: 12500,
      likes: 340,
      comments: 12,
      shares: 5,
    });
    assert.ok(formatted);
    assert.equal(formatted?.views, "12.500");
    assert.equal(formatted?.likes, "340");
    assert.equal(formatted?.comments, "12");
    assert.equal(formatted?.shares, "5");
  });

  it("returns null or default for empty metrics", () => {
    assert.equal(formatCardMetrics(null), null);
    assert.equal(formatCardMetrics(undefined), null);
  });
});
