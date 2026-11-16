import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CarouselSlide } from "./types";
import {
  resolveNextSlideIndex,
  resolvePrevSlideIndex,
  canNavigateNext,
  canNavigatePrev,
  formatSlideBadgeLabel,
} from "./components/SlideLightboxModal";

describe("SlideLightboxModal helpers", () => {
  it("formats slide badge correctly for cover (position 1) and other positions", () => {
    assert.equal(formatSlideBadgeLabel(1), "1 (Capa)");
    assert.equal(formatSlideBadgeLabel(2), "Slide 2");
    assert.equal(formatSlideBadgeLabel(5), "Slide 5");
  });

  it("navigates next and prev correctly", () => {
    const total = 5;
    assert.equal(resolveNextSlideIndex(0, total), 1);
    assert.equal(resolveNextSlideIndex(4, total), 4); // boundary
    assert.equal(resolvePrevSlideIndex(3, total), 2);
    assert.equal(resolvePrevSlideIndex(0, total), 0); // boundary
  });

  it("determines navigation boundaries correctly", () => {
    const total = 4;
    assert.equal(canNavigatePrev(0), false);
    assert.equal(canNavigatePrev(1), true);
    assert.equal(canNavigateNext(0, total), true);
    assert.equal(canNavigateNext(3, total), false);
    assert.equal(canNavigateNext(4, total), false);
  });
});
