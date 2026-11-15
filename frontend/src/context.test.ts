import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accountReducer,
  initialAccountState,
  resolveSelectedAccount,
} from "./context";
import type { Account } from "./types";

describe("AccountContext reducer and pure helpers", () => {
  it("initializes with selectedAccountId set to 'all'", () => {
    assert.equal(initialAccountState.selectedAccountId, "all");
    assert.deepEqual(initialAccountState.accounts, []);
    assert.equal(initialAccountState.loading, false);
    assert.equal(initialAccountState.error, null);
  });

  it("handles SET_ACCOUNT to a specific account id", () => {
    const next = accountReducer(initialAccountState, {
      type: "SET_ACCOUNT",
      payload: "acc_123",
    });
    assert.equal(next.selectedAccountId, "acc_123");
  });

  it("handles SET_ACCOUNT back to 'all'", () => {
    const current = { ...initialAccountState, selectedAccountId: "acc_123" };
    const next = accountReducer(current, {
      type: "SET_ACCOUNT",
      payload: "all",
    });
    assert.equal(next.selectedAccountId, "all");
  });

  it("handles SET_ACCOUNTS and resets error", () => {
    const mockAccounts: Account[] = [
      {
        id: "acc_1",
        display_name: "Persona 1",
        persona: "Persona 1 details",
        role: "single_woman",
        enabled: true,
      },
      {
        id: "acc_2",
        display_name: "Persona 2",
        persona: "Persona 2 details",
        role: "single_man",
        enabled: true,
      },
    ];

    const current = {
      ...initialAccountState,
      loading: true,
      error: "Previous error",
    };
    const next = accountReducer(current, {
      type: "SET_ACCOUNTS",
      payload: mockAccounts,
    });

    assert.deepEqual(next.accounts, mockAccounts);
    assert.equal(next.loading, false);
    assert.equal(next.error, null);
  });

  it("handles SET_LOADING and SET_ERROR", () => {
    const s1 = accountReducer(initialAccountState, {
      type: "SET_LOADING",
      payload: true,
    });
    assert.equal(s1.loading, true);

    const s2 = accountReducer(s1, {
      type: "SET_ERROR",
      payload: "Failed to load",
    });
    assert.equal(s2.error, "Failed to load");
    assert.equal(s2.loading, false);
  });

  it("resolveSelectedAccount returns null for 'all' and matching Account for id", () => {
    const mockAccounts: Account[] = [
      {
        id: "acc_1",
        display_name: "Persona 1",
        persona: "Persona 1 details",
        role: "single_woman",
        enabled: true,
      },
    ];

    assert.equal(resolveSelectedAccount(mockAccounts, "all"), null);
    assert.deepEqual(
      resolveSelectedAccount(mockAccounts, "acc_1"),
      mockAccounts[0]
    );
    assert.equal(resolveSelectedAccount(mockAccounts, "non_existent"), null);
  });
});
