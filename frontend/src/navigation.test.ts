import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TAB,
  NAV_TABS,
  TAB_PATHS,
  buildTabUrl,
  normalizePathname,
  parsePathTab,
  resolveLocation,
} from "./navigation";
import type { NavTab } from "./types";

describe("Navigation & Types verification", () => {
  it("does not include 'gerar' in valid NavTabs", () => {
    const validTabs: NavTab[] = [
      "desempenho",
      "galeria",
      "contas",
      "textos",
      "midias",
      "integracoes",
    ];

    // Assert that 'gerar' is not part of validTabs
    assert.equal((validTabs as string[]).includes("gerar"), false);
    // TypeScript check: this should compile only when NavTab excludes "gerar"
    // @ts-expect-error "gerar" should not be assignable to NavTab
    const invalidTab: NavTab = "gerar";
    assert.ok(invalidTab);
  });
});

describe("URL navigation", () => {
  describe("TAB_PATHS", () => {
    it("defines a distinct path for every tab", () => {
      const paths = NAV_TABS.map((tab) => TAB_PATHS[tab]);
      assert.equal(new Set(paths).size, NAV_TABS.length);
      for (const tab of NAV_TABS) {
        assert.ok(TAB_PATHS[tab].startsWith("/"));
        assert.equal(parsePathTab(TAB_PATHS[tab]), tab);
      }
    });
  });

  describe("normalizePathname", () => {
    it("keeps the root path", () => {
      assert.equal(normalizePathname("/"), "/");
      assert.equal(normalizePathname(""), "/");
    });

    it("strips trailing and duplicate slashes", () => {
      assert.equal(normalizePathname("/galeria/"), "/galeria");
      assert.equal(normalizePathname("//galeria///"), "/galeria");
    });

    it("adds a leading slash and lowercases", () => {
      assert.equal(normalizePathname("Galeria"), "/galeria");
    });
  });

  describe("parsePathTab", () => {
    it("resolves every tab path", () => {
      for (const tab of NAV_TABS) {
        assert.equal(parsePathTab(TAB_PATHS[tab]), tab);
        assert.equal(parsePathTab(`${TAB_PATHS[tab]}/`), tab);
      }
    });

    it("returns undefined for unknown or root paths", () => {
      assert.equal(parsePathTab("/"), undefined);
      assert.equal(parsePathTab("/desconhecido"), undefined);
      assert.equal(parsePathTab("/api/runs"), undefined);
    });
  });

  describe("buildTabUrl", () => {
    it("returns the tab path", () => {
      assert.equal(buildTabUrl("textos"), "/textos");
      assert.equal(buildTabUrl("integracoes"), "/integracoes");
    });

    it("keeps a focused run on the gallery URL", () => {
      assert.equal(buildTabUrl("galeria", "run-1"), "/galeria?run=run-1");
      assert.equal(buildTabUrl("galeria", "run 1"), "/galeria?run=run%201");
    });

    it("drops the run on other tabs and ignores blank runs", () => {
      assert.equal(buildTabUrl("contas", "run-1"), "/contas");
      assert.equal(buildTabUrl("galeria", "   "), "/galeria");
    });
  });

  describe("resolveLocation", () => {
    it("defaults to desempenho at the root", () => {
      assert.deepEqual(resolveLocation("/", ""), {
        tab: "desempenho",
        runId: undefined,
        url: "/desempenho",
      });
      assert.equal(DEFAULT_TAB, "desempenho");
    });

    it("resolves tabs from the path", () => {
      assert.deepEqual(resolveLocation("/contas", ""), {
        tab: "contas",
        runId: undefined,
        url: "/contas",
      });
    });

    it("supports the legacy ?tab= deep link and normalizes it to a path", () => {
      assert.deepEqual(resolveLocation("/", "?tab=galeria&run=run-xyz"), {
        tab: "galeria",
        runId: "run-xyz",
        url: "/galeria?run=run-xyz",
      });
    });

    it("prefers the path over the legacy tab query", () => {
      assert.deepEqual(resolveLocation("/galeria", "?tab=textos"), {
        tab: "galeria",
        runId: undefined,
        url: "/galeria",
      });
    });

    it("reads a focused run from a path-based URL", () => {
      assert.deepEqual(resolveLocation("/galeria", "?run=run-42"), {
        tab: "galeria",
        runId: "run-42",
        url: "/galeria?run=run-42",
      });
    });

    it("ignores runs outside the gallery", () => {
      assert.deepEqual(resolveLocation("/contas", "?run=run-42"), {
        tab: "contas",
        runId: undefined,
        url: "/contas",
      });
    });

    it("falls back to the legacy tab for unknown paths", () => {
      assert.deepEqual(resolveLocation("/desconhecido", "?tab=midias"), {
        tab: "midias",
        runId: undefined,
        url: "/midias",
      });
    });
  });
});
