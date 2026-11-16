import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveGalleryTargetAccountIds } from "./tabs/GalleryPage";
import type { Account } from "./types";

describe("GalleryPage: resolveGalleryTargetAccountIds", () => {
  const mockAccounts: Account[] = [
    { id: "acc_1", display_name: "Account One", persona: "P1", role: "single_woman", enabled: true },
    { id: "acc_2", display_name: "Account Two", persona: "P2", role: "single_man", enabled: false },
    { id: "acc_3", display_name: "Account Three", persona: "P3", role: "couple_men", enabled: true },
  ];

  it("returns only the pinned account ID when selectedAccountId is specific", () => {
    const targets = resolveGalleryTargetAccountIds("acc_1", mockAccounts);
    assert.deepEqual(targets, ["acc_1"]);
  });

  it("returns all enabled account IDs when selectedAccountId is 'all'", () => {
    const targets = resolveGalleryTargetAccountIds("all", mockAccounts);
    assert.deepEqual(targets, ["acc_1", "acc_3"]);
  });

  it("returns empty array when selectedAccountId is 'all' and no accounts are enabled", () => {
    const disabledAccounts: Account[] = [
      { id: "acc_2", persona: "P2", role: "single_man", enabled: false },
    ];
    const targets = resolveGalleryTargetAccountIds("all", disabledAccounts);
    assert.deepEqual(targets, []);
  });
});
