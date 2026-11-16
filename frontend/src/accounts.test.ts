import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isValidRole,
  validateAccountInput,
  ACCOUNT_ROLES,
} from "./types";
import {
  createAccount,
  updateAccount,
  deleteAccount,
  syncSocialAccounts,
  setToken,
  clearToken,
} from "./api";

describe("Accounts configuration & CRUD", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setToken("test-token-123");
  });

  afterEach(() => {
    clearToken();
    globalThis.fetch = originalFetch;
  });

  describe("Role & Input validation", () => {
    it("recognizes the 4 valid account roles", () => {
      assert.deepEqual(ACCOUNT_ROLES, [
        "single_man",
        "single_woman",
        "couple_men",
        "couple_women",
      ]);
      assert.equal(isValidRole("single_man"), true);
      assert.equal(isValidRole("single_woman"), true);
      assert.equal(isValidRole("couple_men"), true);
      assert.equal(isValidRole("couple_women"), true);
      assert.equal(isValidRole("invalid_role"), false);
      assert.equal(isValidRole(""), false);
    });

    it("validates create account input fields", () => {
      const valid = validateAccountInput({
        id: "maria_clara",
        role: "single_woman",
        persona: "Persona 1",
        enabled: true,
      });
      assert.equal(valid.valid, true);
      assert.equal(valid.error, undefined);

      const missingId = validateAccountInput({
        id: "",
        role: "single_woman",
        persona: "Persona 1",
        enabled: true,
      });
      assert.equal(missingId.valid, false);
      assert.match(missingId.error ?? "", /id/i);

      const invalidRole = validateAccountInput({
        id: "joao",
        role: "admin" as any,
        persona: "Persona",
        enabled: true,
      });
      assert.equal(invalidRole.valid, false);
      assert.match(invalidRole.error ?? "", /role/i);
    });
  });

  describe("Accounts API functions", () => {
    it("createAccount sends POST /api/v1/accounts with token", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedHeaders: Headers | undefined;
      let requestedBody = "";

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "GET";
        requestedHeaders = new Headers(init?.headers);
        requestedBody = String(init?.body);

        return new Response(
          JSON.stringify({
            id: "maria_clara",
            role: "single_woman",
            persona: "Persona test",
            enabled: true,
            display_name: "Maria",
            tiktok_open_id: null,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await createAccount({
        id: "maria_clara",
        role: "single_woman",
        persona: "Persona test",
        enabled: true,
        display_name: "Maria",
      });

      assert.equal(requestedUrl, "/api/v1/accounts");
      assert.equal(requestedMethod, "POST");
      assert.equal(requestedHeaders?.get("Authorization"), "Bearer test-token-123");
      assert.deepEqual(JSON.parse(requestedBody), {
        id: "maria_clara",
        role: "single_woman",
        persona: "Persona test",
        enabled: true,
        display_name: "Maria",
      });
      assert.equal(result.id, "maria_clara");
      assert.equal(result.role, "single_woman");
    });

    it("updateAccount sends PATCH /api/v1/accounts/:id", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedHeaders: Headers | undefined;
      let requestedBody = "";

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "GET";
        requestedHeaders = new Headers(init?.headers);
        requestedBody = String(init?.body);

        return new Response(
          JSON.stringify({
            id: "maria_clara",
            role: "single_woman",
            persona: "Updated persona",
            enabled: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await updateAccount("maria_clara", {
        persona: "Updated persona",
        enabled: false,
      });

      assert.equal(requestedUrl, "/api/v1/accounts/maria_clara");
      assert.equal(requestedMethod, "PATCH");
      assert.equal(requestedHeaders?.get("Authorization"), "Bearer test-token-123");
      assert.deepEqual(JSON.parse(requestedBody), {
        persona: "Updated persona",
        enabled: false,
      });
      assert.equal(result.persona, "Updated persona");
      assert.equal(result.enabled, false);
    });

    it("deleteAccount sends DELETE /api/v1/accounts/:id", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedHeaders: Headers | undefined;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "GET";
        requestedHeaders = new Headers(init?.headers);

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const result = await deleteAccount("maria_clara");

      assert.equal(requestedUrl, "/api/v1/accounts/maria_clara");
      assert.equal(requestedMethod, "DELETE");
      assert.equal(requestedHeaders?.get("Authorization"), "Bearer test-token-123");
      assert.equal(result.ok, true);
    });

    it("syncSocialAccounts calls POST /api/v1/social/accounts/sync and returns sync stats", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedHeaders: Headers | undefined;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "GET";
        requestedHeaders = new Headers(init?.headers);

        return new Response(
          JSON.stringify({
            synced: 2,
            matched: 1,
            created: 1,
            accounts: [
              {
                id: "conta_existente",
                persona: "Persona 1",
                external_account_id: "buf_chan_1",
                social_provider: "buffer",
                username: "conta1",
              },
              {
                id: "conta_criada",
                persona: "Conta importada via Buffer (conta2)",
                external_account_id: "buf_chan_2",
                social_provider: "buffer",
                username: "conta2",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await syncSocialAccounts();

      assert.equal(requestedUrl, "/api/v1/social/accounts/sync");
      assert.equal(requestedMethod, "POST");
      assert.equal(requestedHeaders?.get("Authorization"), "Bearer test-token-123");
      assert.equal(result.synced, 2);
      assert.equal(result.matched, 1);
      assert.equal(result.created, 1);
      assert.equal(result.accounts.length, 2);
      assert.equal(result.accounts[0].external_account_id, "buf_chan_1");
    });

    it("updateAccount passes external_account_id and social_provider", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedHeaders: Headers | undefined;
      let requestedBody = "";

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "GET";
        requestedHeaders = new Headers(init?.headers);
        requestedBody = String(init?.body);

        return new Response(
          JSON.stringify({
            id: "maria_clara",
            role: "single_woman",
            persona: "Updated persona",
            enabled: true,
            external_account_id: "buffer-channel-xyz",
            social_provider: "buffer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await updateAccount("maria_clara", {
        external_account_id: "buffer-channel-xyz",
        social_provider: "buffer",
      });

      assert.equal(requestedUrl, "/api/v1/accounts/maria_clara");
      assert.equal(requestedMethod, "PATCH");
      assert.equal(requestedHeaders?.get("Authorization"), "Bearer test-token-123");
      assert.deepEqual(JSON.parse(requestedBody), {
        external_account_id: "buffer-channel-xyz",
        social_provider: "buffer",
      });
      assert.equal(result.external_account_id, "buffer-channel-xyz");
      assert.equal(result.social_provider, "buffer");
    });
  });
});
