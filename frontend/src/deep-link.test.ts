import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDeepLinkParams } from "./App";
import { isRunInView, checkFocusedRunVisibility } from "./tabs/GalleryPage";
import { resolveRunCardClassName } from "./components/RunCard";
import type { CarouselRun } from "./types";

describe("Task 13: Deep link galeria (TDD)", () => {
  describe("parseDeepLinkParams (spec §5.9.3, §5.11 test 11)", () => {
    it("11. extrai { tab, runId } de ?tab=galeria&run=<id>", () => {
      const search = "?tab=galeria&run=123e4567-e89b-12d3-a456-426614174000";
      const result = parseDeepLinkParams(search);
      assert.deepEqual(result, {
        tab: "galeria",
        runId: "123e4567-e89b-12d3-a456-426614174000",
      });
    });

    it("parses without leading question mark", () => {
      const search = "tab=galeria&run=abc-123";
      const result = parseDeepLinkParams(search);
      assert.deepEqual(result, {
        tab: "galeria",
        runId: "abc-123",
      });
    });

    it("accepts runId alias parameter (?tab=galeria&runId=<id>)", () => {
      const search = "?tab=galeria&runId=run-xyz";
      const result = parseDeepLinkParams(search);
      assert.deepEqual(result, {
        tab: "galeria",
        runId: "run-xyz",
      });
    });

    it("returns empty object for empty search string", () => {
      assert.deepEqual(parseDeepLinkParams(""), {});
      assert.deepEqual(parseDeepLinkParams("?"), {});
    });

    it("ignores unknown/invalid tabs but preserves valid runId", () => {
      const search = "?tab=invalid_tab&run=run-789";
      const result = parseDeepLinkParams(search);
      assert.deepEqual(result, {
        runId: "run-789",
      });
    });

    it("supports all valid navigation tabs", () => {
      const tabs = [
        "desempenho",
        "galeria",
        "contas",
        "textos",
        "midias",
        "integracoes",
      ] as const;

      for (const tab of tabs) {
        const result = parseDeepLinkParams(`?tab=${tab}`);
        assert.deepEqual(result, { tab });
      }
    });

    it("ignores whitespace-only run parameter", () => {
      const search = "?tab=galeria&run=   ";
      const result = parseDeepLinkParams(search);
      assert.deepEqual(result, { tab: "galeria" });
    });
  });

  describe("GalleryPage focusedRun visibility helpers (spec §5.9.3)", () => {
    const mockRuns: CarouselRun[] = [
      {
        id: "run-1",
        account_id: "acc_1",
        archetype_title: "Look 1",
        legenda: "Legenda 1",
        status: "generated",
        slides: [],
      },
      {
        id: "run-2",
        account_id: "acc_2",
        archetype_title: "Look 2",
        legenda: "Legenda 2",
        status: "awaiting_approval",
        slides: [],
      },
    ];

    it("isRunInView returns true when run exists in view list", () => {
      assert.equal(isRunInView(mockRuns, "run-1"), true);
      assert.equal(isRunInView(mockRuns, "run-2"), true);
    });

    it("isRunInView returns false when run is not found or runId is undefined", () => {
      assert.equal(isRunInView(mockRuns, "run-999"), false);
      assert.equal(isRunInView(mockRuns, undefined), false);
      assert.equal(isRunInView(mockRuns, ""), false);
      assert.equal(isRunInView([], "run-1"), false);
    });

    it("checkFocusedRunVisibility returns inView=true and showMissingBanner=false when run is in current view", () => {
      const state = checkFocusedRunVisibility(mockRuns, "run-1", false);
      assert.deepEqual(state, { inView: true, showMissingBanner: false });
    });

    it("checkFocusedRunVisibility returns inView=false and showMissingBanner=true when run is missing from view and not loading", () => {
      const state = checkFocusedRunVisibility(mockRuns, "run-nonexistent", false);
      assert.deepEqual(state, { inView: false, showMissingBanner: true });
    });

    it("checkFocusedRunVisibility suppresses missing banner while loading", () => {
      const state = checkFocusedRunVisibility(mockRuns, "run-nonexistent", true);
      assert.deepEqual(state, { inView: false, showMissingBanner: false });
    });

    it("checkFocusedRunVisibility returns false for both when focusedRunId is absent", () => {
      const state = checkFocusedRunVisibility(mockRuns, undefined, false);
      assert.deepEqual(state, { inView: false, showMissingBanner: false });
    });

    it("resolveRunCardClassName includes run-card--focused class when isFocused is true", () => {
      const className = resolveRunCardClassName("generated", true);
      assert.ok(className.includes("run-card--focused"));
      assert.equal(className, "run-card status-generated run-card--focused");
    });

    it("resolveRunCardClassName omits run-card--focused class when isFocused is false or omitted", () => {
      const classWithout = resolveRunCardClassName("generated");
      assert.ok(!classWithout.includes("run-card--focused"));
      assert.equal(classWithout, "run-card status-generated");

      const classFalse = resolveRunCardClassName("awaiting_approval", false);
      assert.ok(!classFalse.includes("run-card--focused"));
      assert.equal(classFalse, "run-card status-awaiting_approval");
    });
  });
});
