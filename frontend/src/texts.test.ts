import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  CONTENT_SCOPES,
} from "./types";
import {
  getArchetypes,
  putArchetypes,
  deleteArchetype,
  getBaits,
  putBaits,
  deleteBait,
  setToken,
  clearToken,
} from "./api";

describe("Texts configuration (Archetypes & Baits)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setToken("test-token-texts");
  });

  afterEach(() => {
    clearToken();
    globalThis.fetch = originalFetch;
  });

  it("defines shared plus 4 role content scopes", () => {
    assert.deepEqual(CONTENT_SCOPES, [
      "shared",
      "single_man",
      "single_woman",
      "couple_men",
      "couple_women",
    ]);
  });

  describe("Archetypes API", () => {
    it("getArchetypes calls GET /api/v1/archetypes with scope", async () => {
      let requestedUrl = "";
      let requestedHeaders: Headers | undefined;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedHeaders = new Headers(init?.headers);

        return new Response(
          JSON.stringify([
            { id: "arch_1", scope: "couple_men", title: "Arquétipo A", sort_order: 0, active: true },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await getArchetypes("couple_men");

      assert.equal(requestedUrl, "/api/v1/archetypes?scope=couple_men");
      assert.equal(requestedHeaders?.get("Authorization"), "Bearer test-token-texts");
      assert.equal(result.length, 1);
      assert.equal(result[0].title, "Arquétipo A");
    });

    it("putArchetypes calls PUT /api/v1/archetypes with scope and items", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedBody = "";

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "GET";
        requestedBody = String(init?.body);

        return new Response(
          JSON.stringify([
            { id: "arch_1", scope: "shared", title: "Novo", sort_order: 0, active: true },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const items = [{ id: "arch_1", title: "Novo", sort_order: 0, active: true }];
      const result = await putArchetypes("shared", items);

      assert.equal(requestedUrl, "/api/v1/archetypes");
      assert.equal(requestedMethod, "PUT");
      assert.deepEqual(JSON.parse(requestedBody), {
        scope: "shared",
        items,
      });
      assert.equal(result[0].title, "Novo");
    });

    it("deleteArchetype calls DELETE /api/v1/archetypes/:id", async () => {
      let requestedUrl = "";
      let requestedMethod = "";

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "GET";

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const result = await deleteArchetype("arch_1");

      assert.equal(requestedUrl, "/api/v1/archetypes/arch_1");
      assert.equal(requestedMethod, "DELETE");
      assert.equal(result.success, true);
    });
  });

  describe("Baits API", () => {
    it("getBaits calls GET /api/v1/baits with scope", async () => {
      let requestedUrl = "";

      globalThis.fetch = async (input: RequestInfo | URL) => {
        requestedUrl = String(input);

        return new Response(
          JSON.stringify([
            { id: "bait_1", scope: "shared", body: "Gancho 1", sort_order: 0, active: true },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await getBaits("shared");

      assert.equal(requestedUrl, "/api/v1/baits?scope=shared");
      assert.equal(result.length, 1);
      assert.equal(result[0].body, "Gancho 1");
    });

    it("putBaits calls PUT /api/v1/baits with scope and items", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedBody = "";

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "GET";
        requestedBody = String(init?.body);

        return new Response(
          JSON.stringify([
            { id: "bait_1", scope: "single_woman", body: "Gancho Mulher", sort_order: 0, active: true },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const items = [{ id: "bait_1", body: "Gancho Mulher", sort_order: 0, active: true }];
      const result = await putBaits("single_woman", items);

      assert.equal(requestedUrl, "/api/v1/baits");
      assert.equal(requestedMethod, "PUT");
      assert.deepEqual(JSON.parse(requestedBody), {
        scope: "single_woman",
        items,
      });
      assert.equal(result[0].body, "Gancho Mulher");
    });

    it("deleteBait calls DELETE /api/v1/baits/:id", async () => {
      let requestedUrl = "";
      let requestedMethod = "";

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "GET";

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const result = await deleteBait("bait_1");

      assert.equal(requestedUrl, "/api/v1/baits/bait_1");
      assert.equal(requestedMethod, "DELETE");
      assert.equal(result.success, true);
    });
  });
});
