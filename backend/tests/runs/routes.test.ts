import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import sharp from "sharp";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import { replaceArchetypesForScope } from "../../src/domain/archetypes/store.js";
import { replaceBaitsForScope } from "../../src/domain/baits/store.js";
import { scanMediaToDb } from "../../src/domain/media/store.js";
import { generateBatch } from "../../src/domain/runs/generate.js";

const { Pool } = pg;

describe("Task 12: Generation jobs API (carousels routes)", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let app: FastifyInstance;
  let tmpMediaDir: string;
  let tmpOutputDir: string;

  const testToken = "test-secret-token-routes";
  const authHeaders = { authorization: `Bearer ${testToken}` };

  const mockCopy = {
    tema_escolhido: "Dicas de Estilo para Mulheres Elegantes",
    slides: [
      {
        numero: 1,
        imagem_ref: "capa_01.jpg",
        texto: "5 Peças Essenciais Para o Seu Guarda-Roupa",
      },
      {
        numero: 2,
        imagem_ref: "aleat_01.jpg",
        texto: "1. Uma camisa de linho bem cortada",
      },
      {
        numero: 3,
        imagem_ref: "aleat_02.jpg",
        texto: "2. Calça de alfaiataria em tom neutro",
      },
      {
        numero: 4,
        imagem_ref: "shared_01.jpg",
        texto: "3. Blazer oversized estruturado",
      },
      {
        numero: 5,
        imagem_ref: "shared_02.jpg",
        texto: "4. Acessórios minimalistas de ouro",
      },
      {
        numero: 6,
        imagem_ref: "listo_01.png",
        texto: "Gostou das dicas? Salve este post e compartilhe!",
      },
    ],
    legenda_tiktok: "Confira as peças essenciais que elevam qualquer look! #moda #elegancia #estilo",
  };

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

    // Create temporary media root with sample images
    tmpMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "task12-media-"));
    tmpOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "task12-output-"));
    process.env.MEDIA_ROOT = tmpMediaDir;
    process.env.OUTPUT_DIR = tmpOutputDir;

    const dirs = [
      path.join(tmpMediaDir, "single_woman", "capas"),
      path.join(tmpMediaDir, "single_woman", "aleatorias"),
      path.join(tmpMediaDir, "single_man", "capas"),
      path.join(tmpMediaDir, "single_man", "aleatorias"),
      path.join(tmpMediaDir, "shared", "aleatorias"),
      path.join(tmpMediaDir, "shared", "listo"),
    ];
    for (const d of dirs) {
      fs.mkdirSync(d, { recursive: true });
    }

    const createTestImage = async (dest: string) => {
      await sharp({
        create: {
          width: 1080,
          height: 1920,
          channels: 3,
          background: { r: 120, g: 150, b: 200 },
        },
      })
        .jpeg()
        .toFile(dest);
    };

    // Woman media
    await createTestImage(path.join(tmpMediaDir, "single_woman", "capas", "capa_01.jpg"));
    await createTestImage(path.join(tmpMediaDir, "single_woman", "capas", "capa_02.jpg"));
    await createTestImage(path.join(tmpMediaDir, "single_woman", "aleatorias", "aleat_01.jpg"));
    await createTestImage(path.join(tmpMediaDir, "single_woman", "aleatorias", "aleat_02.jpg"));
    await createTestImage(path.join(tmpMediaDir, "single_woman", "aleatorias", "aleat_03.jpg"));

    // Man media
    await createTestImage(path.join(tmpMediaDir, "single_man", "capas", "capa_man_01.jpg"));
    await createTestImage(path.join(tmpMediaDir, "single_man", "aleatorias", "aleat_man_01.jpg"));
    await createTestImage(path.join(tmpMediaDir, "single_man", "aleatorias", "aleat_man_02.jpg"));
    await createTestImage(path.join(tmpMediaDir, "single_man", "aleatorias", "aleat_man_03.jpg"));

    // Shared media
    await createTestImage(path.join(tmpMediaDir, "shared", "aleatorias", "shared_01.jpg"));
    await createTestImage(path.join(tmpMediaDir, "shared", "aleatorias", "shared_02.jpg"));
    await createTestImage(path.join(tmpMediaDir, "shared", "listo", "listo_01.png"));

    app = await buildApp();
  });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE TABLE media_usage, carousel_slides, carousel_runs, generation_jobs, media_assets, baits, archetypes, accounts CASCADE;"
    );

    if (tmpOutputDir && fs.existsSync(tmpOutputDir)) {
      fs.rmSync(tmpOutputDir, { recursive: true, force: true });
      fs.mkdirSync(tmpOutputDir, { recursive: true });
    }

    // Seed 2 active accounts and 1 disabled account
    await upsertAccount(
      {
        id: "acc_woman_1",
        persona: "Mulher madura e elegante",
        role: "single_woman",
        enabled: true,
      },
      pool
    );
    await upsertAccount(
      {
        id: "acc_man_1",
        persona: "Homem moderno e sofisticado",
        role: "single_man",
        enabled: true,
      },
      pool
    );
    await upsertAccount(
      {
        id: "acc_disabled",
        persona: "Conta desativada",
        role: "single_woman",
        enabled: false,
      },
      pool
    );

    // Seed content for single_woman
    await replaceArchetypesForScope(
      "single_woman",
      [{ title: "Guarda-Roupa Inteligente", sort_order: 1 }],
      pool
    );
    await replaceBaitsForScope(
      "single_woman",
      [{ body: "Você comete esse erro clássico?", sort_order: 1 }],
      pool
    );

    // Seed content for single_man
    await replaceArchetypesForScope(
      "single_man",
      [{ title: "Estilo Masculino Essencial", sort_order: 1 }],
      pool
    );
    await replaceBaitsForScope(
      "single_man",
      [{ body: "Como combinar cores sem erro", sort_order: 1 }],
      pool
    );

    // Scan media to DB
    await scanMediaToDb(tmpMediaDir, pool);
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
    if (tmpOutputDir && fs.existsSync(tmpOutputDir)) {
      fs.rmSync(tmpOutputDir, { recursive: true, force: true });
    }
  });

  describe("Step 1: Unknown accountId -> 404; multi-id creates one job + N runs", () => {
    it("POST /api/v1/carousels/generate with unknown accountId returns 404 not_found", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/carousels/generate",
        headers: authHeaders,
        payload: {
          accountIds: ["non_existent_account_xyz"],
          mockCopy,
          skipRender: true,
        },
      });

      assert.equal(res.statusCode, 404);
      const json = res.json();
      assert.equal(json.error, "not_found");
      assert.match(json.message, /Account not found/);

      // Verify no generation_jobs row was created
      const jobCount = await pool.query("SELECT COUNT(*) FROM generation_jobs;");
      assert.equal(Number(jobCount.rows[0].count), 0);
    });

    it("POST /api/v1/carousels/generate with multiple accountIds creates one job and N runs (1 run per account)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/carousels/generate",
        headers: authHeaders,
        payload: {
          accountIds: ["acc_woman_1", "acc_man_1"],
          mockCopy,
          skipRender: true,
        },
      });

      assert.equal(res.statusCode, 200);
      const json = res.json();

      // Check job id in response
      assert.ok(json.id || json.jobId, "Response should contain job id");
      const jobId = json.id || json.jobId;

      // Check 1 job in DB
      const jobsRes = await pool.query("SELECT * FROM generation_jobs WHERE id = $1;", [jobId]);
      assert.equal(jobsRes.rows.length, 1);
      assert.deepEqual(jobsRes.rows[0].account_ids, ["acc_woman_1", "acc_man_1"]);
      assert.equal(jobsRes.rows[0].status, "completed");

      // Check N runs in DB with this jobId
      const runsRes = await pool.query("SELECT * FROM carousel_runs WHERE job_id = $1 ORDER BY created_at ASC;", [jobId]);
      assert.equal(runsRes.rows.length, 2);
      const runAccountIds = runsRes.rows.map((r: any) => r.account_id).sort();
      assert.deepEqual(runAccountIds, ["acc_man_1", "acc_woman_1"]);
    });

    it("POST /api/v1/carousels/generate omitting accountIds creates runs for only enabled accounts", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/carousels/generate",
        headers: authHeaders,
        payload: {
          mockCopy,
          skipRender: true,
        },
      });

      assert.equal(res.statusCode, 200);
      const json = res.json();
      const jobId = json.id || json.jobId;

      const runsRes = await pool.query("SELECT * FROM carousel_runs WHERE job_id = $1;", [jobId]);
      assert.equal(runsRes.rows.length, 2, "Should create runs for the 2 enabled accounts only");
      const runAccountIds = runsRes.rows.map((r: any) => r.account_id);
      assert.ok(!runAccountIds.includes("acc_disabled"), "Disabled account must not be generated");
    });

    it("generateBatch directly filters enabled accounts when called with empty options", async () => {
      const result = await generateBatch({
        mockCopy,
        skipRender: true,
        pool,
        mediaRoot: tmpMediaDir,
        outputDir: tmpOutputDir,
      });

      assert.ok(result.job.id);
      assert.equal(result.runs.length, 2);
      const generatedAccountIds = result.runs.map((r) => r.account_id);
      assert.ok(!generatedAccountIds.includes("acc_disabled"));
    });
  });

  describe("Step 2: Return job progress fields for UI polling and query runs/job", () => {
    it("POST /api/v1/carousels/generate returns full job progress fields for UI polling", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/carousels/generate",
        headers: authHeaders,
        payload: {
          accountIds: ["acc_woman_1"],
          mockCopy,
          skipRender: true,
        },
      });

      assert.equal(res.statusCode, 200);
      const json = res.json();

      assert.ok(json.id, "job id must be present");
      assert.equal(json.status, "completed");
      assert.equal(json.total, 1);
      assert.equal(json.completed, 1);
      assert.equal(json.failed, 0);
      assert.ok(json.started_at, "started_at must be present");
      assert.ok(json.finished_at, "finished_at must be present");
      assert.ok(Array.isArray(json.runs), "runs array must be returned");
      assert.equal(json.runs.length, 1);
      assert.equal(json.runs[0].account_id, "acc_woman_1");
    });

    it("GET /api/v1/carousels/jobs/:id returns progress and runs for polling", async () => {
      // First trigger generation
      const genRes = await app.inject({
        method: "POST",
        url: "/api/v1/carousels/generate",
        headers: authHeaders,
        payload: {
          accountIds: ["acc_woman_1", "acc_man_1"],
          mockCopy,
          skipRender: true,
        },
      });
      const jobId = genRes.json().id || genRes.json().jobId;

      // Poll the job
      const pollRes = await app.inject({
        method: "GET",
        url: `/api/v1/carousels/jobs/${jobId}`,
        headers: authHeaders,
      });

      assert.equal(pollRes.statusCode, 200);
      const pollJson = pollRes.json();
      assert.equal(pollJson.id, jobId);
      assert.equal(pollJson.status, "completed");
      assert.equal(pollJson.total, 2);
      assert.equal(pollJson.completed, 2);
      assert.equal(pollJson.failed, 0);
      assert.equal(pollJson.runs.length, 2);
    });

    it("GET /api/v1/carousels/jobs/:id returns 404 for unknown job id", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/carousels/jobs/${crypto.randomUUID()}`,
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error, "not_found");
    });

    it("GET /api/v1/carousels/runs returns runs list with filters (accountId, limit, offset)", async () => {
      // Generate runs for both accounts
      await app.inject({
        method: "POST",
        url: "/api/v1/carousels/generate",
        headers: authHeaders,
        payload: {
          accountIds: ["acc_woman_1", "acc_man_1"],
          mockCopy,
          skipRender: true,
        },
      });

      // Filter by accountId
      const resFiltered = await app.inject({
        method: "GET",
        url: "/api/v1/carousels/runs?accountId=acc_woman_1",
        headers: authHeaders,
      });
      assert.equal(resFiltered.statusCode, 200);
      const runs = resFiltered.json();
      assert.equal(runs.length, 1);
      assert.equal(runs[0].account_id, "acc_woman_1");

      // Pagination test
      const resPage = await app.inject({
        method: "GET",
        url: "/api/v1/carousels/runs?limit=1&offset=0",
        headers: authHeaders,
      });
      assert.equal(resPage.statusCode, 200);
      assert.equal(resPage.json().length, 1);

      // Support empty query strings without validation failure (?accountId=&limit=&offset=)
      const resEmptyQuery = await app.inject({
        method: "GET",
        url: "/api/v1/carousels/runs?accountId=&limit=&offset=",
        headers: authHeaders,
      });
      assert.equal(resEmptyQuery.statusCode, 200);
      assert.equal(resEmptyQuery.json().length, 2);
    });

    it("GET /api/v1/carousels/runs/:id returns run with slides", async () => {
      const genRes = await app.inject({
        method: "POST",
        url: "/api/v1/carousels/generate",
        headers: authHeaders,
        payload: {
          accountIds: ["acc_woman_1"],
          mockCopy,
          skipRender: true,
        },
      });
      const runId = genRes.json().runs[0].id;

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/carousels/runs/${runId}`,
        headers: authHeaders,
      });

      assert.equal(res.statusCode, 200);
      const run = res.json();
      assert.equal(run.id, runId);
      assert.ok(Array.isArray(run.slides), "Run should contain slides array");
      assert.equal(run.slides.length, 6);
      assert.equal(run.slides[0].position, 1);
    });

    it("GET /api/v1/carousels/runs/:id returns 404 for unknown run id", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/carousels/runs/${crypto.randomUUID()}`,
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error, "not_found");
    });
  });
});