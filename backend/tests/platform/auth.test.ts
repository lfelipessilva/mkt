import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";

describe("platform auth & app shell", () => {
  let app: FastifyInstance;
  const originalToken = process.env.API_TOKEN;
  const testToken = "test-secret-token-123";

  before(async () => {
    process.env.API_TOKEN = testToken;
    app = await buildApp();
  });

  after(async () => {
    await app.close();
    if (originalToken !== undefined) {
      process.env.API_TOKEN = originalToken;
    } else {
      delete process.env.API_TOKEN;
    }
  });

  describe("Public routes", () => {
    it("GET /health returns 200 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { ok: true });
    });
  });

  describe("Protected /api/v1/* routes", () => {
    it("GET /api/v1/ping without header returns 401", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/ping" });
      assert.equal(res.statusCode, 401);
      const json = res.json();
      assert.equal(json.error, "unauthorized");
    });

    it("GET /api/v1/ping with invalid token returns 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/ping",
        headers: { authorization: "Bearer invalid-token" },
      });
      assert.equal(res.statusCode, 401);
      const json = res.json();
      assert.equal(json.error, "unauthorized");
    });

    it("GET /api/v1/ping with malformed header returns 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/ping",
        headers: { authorization: "Basic some-creds" },
      });
      assert.equal(res.statusCode, 401);
      const json = res.json();
      assert.equal(json.error, "unauthorized");
    });

    it("GET /api/v1/ping with valid Bearer token returns 200", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/ping",
        headers: { authorization: `Bearer ${testToken}` },
      });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { ok: true });
    });
  });
});
