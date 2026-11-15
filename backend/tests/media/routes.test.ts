import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { scanMediaToDb, listMediaAssets, deleteMediaAsset } from "../../src/domain/media/store.js";
import { scopeToDir } from "../../src/domain/media/paths.js";

const { Pool } = pg;

describe("media assets routes, store & traversal security", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let app: FastifyInstance;
  let tmpMediaDir: string;
  const testToken = "test-secret-token-media";
  const authHeaders = { authorization: `Bearer ${testToken}` };

  before(async () => {
    process.env.API_TOKEN = testToken;
    let connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      connectionString = container.getConnectionUri();
      process.env.DATABASE_URL = connectionString;
    }

    pool = new Pool({ connectionString });
    await runMigrations(pool);

    // Create temporary media root directory for isolated test operations
    tmpMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "media-test-root-"));
    process.env.MEDIA_ROOT = tmpMediaDir;

    // Create standard scope directories
    fs.mkdirSync(path.join(tmpMediaDir, "single_man", "capas"), { recursive: true });
    fs.mkdirSync(path.join(tmpMediaDir, "single_man", "aleatorias"), { recursive: true });
    fs.mkdirSync(path.join(tmpMediaDir, "shared", "listo"), { recursive: true });

    // Seed dummy image files
    fs.writeFileSync(
      path.join(tmpMediaDir, "single_man", "capas", "man_capa.jpg"),
      Buffer.from("sample-jpg-bytes")
    );
    fs.writeFileSync(
      path.join(tmpMediaDir, "shared", "listo", "listo_screen.png"),
      Buffer.from("sample-png-bytes")
    );
    // .gitkeep should be ignored
    fs.writeFileSync(path.join(tmpMediaDir, "single_man", "aleatorias", ".gitkeep"), "");

    app = await buildApp();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE media_assets CASCADE;");
  });

  after(async () => {
    if (app) {
      await app.close();
    }
    await closePool();
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
    if (tmpMediaDir && fs.existsSync(tmpMediaDir)) {
      fs.rmSync(tmpMediaDir, { recursive: true, force: true });
    }
  });

  describe("Step 1: Test file endpoint rejects ../../etc/passwd & enforces auth", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/media/file?path=single_man/capas/man_capa.jpg",
      });
      assert.equal(res.statusCode, 401);
    });

    it("rejects missing path parameter with 400", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/media/file",
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 400);
    });

    it("rejects ../../etc/passwd path traversal with 400", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/media/file?path=../../etc/passwd",
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 400);
      const json = res.json();
      assert.match(json.message, /traversal|invalid/i);
    });

    it("rejects nested traversal like media/../../../etc/passwd with 400", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/media/file?path=media/../../../etc/passwd",
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 400);
    });

    it("rejects absolute path traversal with 400", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/media/file?path=/etc/passwd",
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 400);
    });

    it("returns 404 for non-existent file inside media root", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/media/file?path=single_man/capas/non_existent.jpg",
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 404);
    });

    it("returns 200 and image file contents when file exists", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/media/file?path=single_man/capas/man_capa.jpg",
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body, "sample-jpg-bytes");
      assert.match(res.headers["content-type"] as string, /image\/jpeg/);
    });

    it("supports path with leading 'media/' prefix", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/media/file?path=media/shared/listo/listo_screen.png",
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body, "sample-png-bytes");
      assert.match(res.headers["content-type"] as string, /image\/png/);
    });
  });

  describe("Step 2: scanMediaToDb & GET /api/v1/media", () => {
    it("scans files from disk and upserts into media_assets ignoring .gitkeep", async () => {
      const count = await scanMediaToDb(tmpMediaDir, pool);
      assert.equal(count, 2);

      const items = await listMediaAssets({}, pool);
      assert.equal(items.length, 2);

      const capas = items.find((i) => i.filename === "man_capa.jpg");
      assert.ok(capas);
      assert.equal(capas.scope, "single_man");
      assert.equal(capas.category, "capas");
      assert.equal(capas.byte_size, 16);
      assert.equal(capas.active, true);

      const listo = items.find((i) => i.filename === "listo_screen.png");
      assert.ok(listo);
      assert.equal(listo.scope, "shared");
      assert.equal(listo.category, "listo");
    });

    it("is idempotent: scanning twice does not duplicate records", async () => {
      const count1 = await scanMediaToDb(tmpMediaDir, pool);
      assert.equal(count1, 2);

      const count2 = await scanMediaToDb(tmpMediaDir, pool);
      assert.equal(count2, 2);

      const items = await listMediaAssets({}, pool);
      assert.equal(items.length, 2);
    });

    it("GET /api/v1/media filters by scope and category", async () => {
      await scanMediaToDb(tmpMediaDir, pool);

      // Filter by scope
      const resScope = await app.inject({
        method: "GET",
        url: "/api/v1/media?scope=single_man",
        headers: authHeaders,
      });
      assert.equal(resScope.statusCode, 200);
      const itemsScope = resScope.json();
      assert.equal(itemsScope.length, 1);
      assert.equal(itemsScope[0].filename, "man_capa.jpg");

      // Filter by scope and category
      const resCategory = await app.inject({
        method: "GET",
        url: "/api/v1/media?scope=shared&category=listo",
        headers: authHeaders,
      });
      assert.equal(resCategory.statusCode, 200);
      const itemsCategory = resCategory.json();
      assert.equal(itemsCategory.length, 1);
      assert.equal(itemsCategory[0].filename, "listo_screen.png");

      // Filter with no matches
      const resEmpty = await app.inject({
        method: "GET",
        url: "/api/v1/media?scope=couple_men",
        headers: authHeaders,
      });
      assert.equal(resEmpty.statusCode, 200);
      assert.deepEqual(resEmpty.json(), []);
    });
  });

  describe("Step 3: Upload writes under scopeToDir(scope)/category/", () => {
    it("POST /api/v1/media/upload writes file under scope directory and creates DB asset", async () => {
      const form = new FormData();
      form.append("scope", "single_woman");
      form.append("category", "capas");
      form.append(
        "file",
        new Blob(["uploaded-test-image-content"], { type: "image/jpeg" }),
        "uploaded_woman.jpg"
      );

      const resObj = new Response(form);
      const payload = Buffer.from(await resObj.arrayBuffer());

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/media/upload",
        headers: {
          ...authHeaders,
          "content-type": resObj.headers.get("content-type")!,
        },
        payload,
      });

      assert.equal(res.statusCode, 201);
      const asset = res.json();
      assert.equal(asset.scope, "single_woman");
      assert.equal(asset.category, "capas");
      assert.equal(asset.filename, "uploaded_woman.jpg");
      assert.equal(asset.byte_size, 27);
      assert.equal(asset.storage_path, "media/single_woman/capas/uploaded_woman.jpg");

      // Verify file exists on disk under mediaRoot/single_woman/capas/uploaded_woman.jpg
      const expectedDiskPath = path.join(tmpMediaDir, "single_woman", "capas", "uploaded_woman.jpg");
      assert.ok(fs.existsSync(expectedDiskPath));
      assert.equal(fs.readFileSync(expectedDiskPath, "utf-8"), "uploaded-test-image-content");
    });

    it("rejects invalid scope or category with 400", async () => {
      const form = new FormData();
      form.append("scope", "invalid_scope");
      form.append("category", "capas");
      form.append(
        "file",
        new Blob(["data"], { type: "image/jpeg" }),
        "bad_scope.jpg"
      );

      const resObj = new Response(form);
      const payload = Buffer.from(await resObj.arrayBuffer());

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/media/upload",
        headers: {
          ...authHeaders,
          "content-type": resObj.headers.get("content-type")!,
        },
        payload,
      });

      assert.equal(res.statusCode, 400);
    });

    it("rejects category not valid for scope (e.g. listo for single_woman) with 400", async () => {
      const form = new FormData();
      form.append("scope", "single_woman");
      form.append("category", "listo");
      form.append(
        "file",
        new Blob(["data"], { type: "image/jpeg" }),
        "invalid_category.jpg"
      );

      const resObj = new Response(form);
      const payload = Buffer.from(await resObj.arrayBuffer());

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/media/upload",
        headers: {
          ...authHeaders,
          "content-type": resObj.headers.get("content-type")!,
        },
        payload,
      });

      assert.equal(res.statusCode, 400);
    });
  });

  describe("Step 4: DELETE /api/v1/media body { storage_path }", () => {
    it("deletes asset from DB and disk", async () => {
      // First upload an asset
      const form = new FormData();
      form.append("scope", "single_man");
      form.append("category", "capas");
      form.append(
        "file",
        new Blob(["to-be-deleted"], { type: "image/jpeg" }),
        "delete_me.jpg"
      );

      const resObj = new Response(form);
      const payload = Buffer.from(await resObj.arrayBuffer());

      const uploadRes = await app.inject({
        method: "POST",
        url: "/api/v1/media/upload",
        headers: {
          ...authHeaders,
          "content-type": resObj.headers.get("content-type")!,
        },
        payload,
      });
      assert.equal(uploadRes.statusCode, 201);
      const asset = uploadRes.json();

      const diskPath = path.join(tmpMediaDir, "single_man", "capas", "delete_me.jpg");
      assert.ok(fs.existsSync(diskPath));

      // DELETE /api/v1/media
      const delRes = await app.inject({
        method: "DELETE",
        url: "/api/v1/media",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        payload: { storage_path: asset.storage_path },
      });

      assert.equal(delRes.statusCode, 200);
      assert.equal(delRes.json().ok, true);

      // Verify file was deleted from disk
      assert.ok(!fs.existsSync(diskPath));

      // Verify asset is no longer returned in DB list
      const list = await listMediaAssets({ scope: "single_man" }, pool);
      assert.ok(!list.some((a) => a.storage_path === asset.storage_path));
    });

    it("returns 404 when deleting a non-existent storage_path", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/v1/media",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        payload: { storage_path: "media/shared/listo/does_not_exist.jpg" },
      });
      assert.equal(res.statusCode, 404);
    });

    it("direct deleteMediaAsset store function deletes asset", async () => {
      await scanMediaToDb(tmpMediaDir, pool);
      const items = await listMediaAssets({ scope: "single_man" }, pool);
      assert.ok(items.length > 0);

      await deleteMediaAsset(items[0].storage_path, tmpMediaDir, pool);
      const after = await listMediaAssets({ scope: "single_man" }, pool);
      assert.ok(!after.some((a) => a.storage_path === items[0].storage_path));
    });
  });
});
