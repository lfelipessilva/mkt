import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
