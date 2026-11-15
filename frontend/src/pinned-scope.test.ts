import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDefaultScope, type Account } from "./types";

describe("Pinned account scope resolution (Step 4)", () => {
  const mockSingleWomanAccount: Account = {
    id: "acc_maria",
    display_name: "Maria Clara",
    persona: "Lifestyle feminina",
    role: "single_woman",
    enabled: true,
  };

  const mockCoupleMenAccount: Account = {
    id: "acc_marcos_lucas",
    display_name: "Marcos & Lucas",
    persona: "Casal masculino",
    role: "couple_men",
    enabled: true,
  };

  it("returns 'shared' when context is 'all'", () => {
    const scope = resolveDefaultScope("all", null);
    assert.equal(scope, "shared");
  });

  it("returns 'shared' when context is 'all' even if account object is passed", () => {
    const scope = resolveDefaultScope("all", mockSingleWomanAccount);
    assert.equal(scope, "shared");
  });

  it("returns account role when an account is pinned", () => {
    const scopeWoman = resolveDefaultScope("acc_maria", mockSingleWomanAccount);
    assert.equal(scopeWoman, "single_woman");

    const scopeCouple = resolveDefaultScope(
      "acc_marcos_lucas",
      mockCoupleMenAccount
    );
    assert.equal(scopeCouple, "couple_men");
  });

  it("falls back to 'shared' if pinned account id has no loaded account object", () => {
    const scope = resolveDefaultScope("unknown_id", null);
    assert.equal(scope, "shared");
  });
});
