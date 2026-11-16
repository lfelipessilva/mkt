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
import { upsertAccount } from "../../src/domain/accounts/store.js";
import { replaceArchetypesForScope } from "../../src/domain/archetypes/store.js";
import { replaceBaitsForScope } from "../../src/domain/baits/store.js";
import { upsertMediaAsset } from "../../src/domain/media/store.js";
import { generateBatch } from "../../src/domain/runs/generate.js";
import { isAutoDispatchEnabled, startCron } from "../../src/cron.js";
import { withJobLock, getJobStatus } from "../../src/jobLock.js";
import { createBot } from "../../src/bot.js";

const { Pool } = pg;

describe("Task 13: Cron, bot, auto-dispatch hooks", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let tmpMediaDir: string;
  let tmpOutputDir: string;

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
        imagem_ref: "aleat_03.jpg",
        texto: "3. Blazer com caimento perfeito",
      },
      {
        numero: 5,
        imagem_ref: "aleat_04.jpg",
        texto: "4. Acessórios minimalistas",
      },
      {
        numero: 6,
        imagem_ref: "aleat_05.jpg",
        texto: "5. Sapatos clássicos confortáveis",
      },
    ],
    legenda_tiktok: "Qual dessas peças não pode faltar no seu guarda-roupa? #estilo #moda",
  };

  async function createBlankImage(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 120, g: 120, b: 120 },
      },
    })
      .jpeg()
      .toFile(filePath);
  }

  before(async () => {
    let connStr = process.env.DATABASE_URL;
    if (!connStr) {
      try {
        container = await new PostgreSqlContainer("postgres:16-alpine").start();
        connStr = container.getConnectionUri();
      } catch {
        connStr = "postgresql://luisfelipe@localhost:5432/redhorse_test";
      }
    }
    process.env.DATABASE_URL = connStr;

    pool = new Pool({ connectionString: connStr });
    await runMigrations(pool);

    tmpMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "cron-media-test-"));
    tmpOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "cron-output-test-"));
    process.env.MEDIA_ROOT = tmpMediaDir;
    process.env.OUTPUT_DIR = tmpOutputDir;

    const seedMedia = [
      // Shared media
      { scope: "shared", category: "random", filename: "aleat_03.jpg", path: path.join(tmpMediaDir, "shared/random/aleat_03.jpg") },
      { scope: "shared", category: "random", filename: "aleat_04.jpg", path: path.join(tmpMediaDir, "shared/random/aleat_04.jpg") },
      { scope: "shared", category: "random", filename: "aleat_05.jpg", path: path.join(tmpMediaDir, "shared/random/aleat_05.jpg") },
      { scope: "shared", category: "listo", filename: "listo_01.png", path: path.join(tmpMediaDir, "shared/listo/listo_01.png") },
      // Woman media
      { scope: "single_woman", category: "cover", filename: "capa_01.jpg", path: path.join(tmpMediaDir, "single_woman/cover/capa_01.jpg") },
      { scope: "single_woman", category: "random", filename: "aleat_01.jpg", path: path.join(tmpMediaDir, "single_woman/random/aleat_01.jpg") },
      { scope: "single_woman", category: "random", filename: "aleat_02.jpg", path: path.join(tmpMediaDir, "single_woman/random/aleat_02.jpg") },
      // Man media
      { scope: "single_man", category: "cover", filename: "capa_man_01.jpg", path: path.join(tmpMediaDir, "single_man/cover/capa_man_01.jpg") },
      { scope: "single_man", category: "random", filename: "aleat_man_01.jpg", path: path.join(tmpMediaDir, "single_man/random/aleat_man_01.jpg") },
      { scope: "single_man", category: "random", filename: "aleat_man_02.jpg", path: path.join(tmpMediaDir, "single_man/random/aleat_man_02.jpg") },
    ];

    for (const m of seedMedia) {
      await createBlankImage(m.path);
      await upsertMediaAsset(
        {
          scope: m.scope as any,
          category: m.category as any,
          storage_path: m.path,
          filename: m.filename,
        },
        pool
      );
    }

    // Seed content
    await replaceArchetypesForScope(
      "single_woman",
      [
        {
          title: "Mulher Elegante",
          description: "Estilo e postura elegante",
          sort_order: 1,
        },
      ],
      pool
    );

    await replaceBaitsForScope(
      "single_woman",
      [
        {
          body: "5 peças que toda mulher elegante usa",
          sort_order: 1,
        },
      ],
      pool
    );

    await replaceArchetypesForScope(
      "single_man",
      [
        {
          title: "Homem Moderno",
          description: "Estilo masculino contemporâneo",
          sort_order: 1,
        },
      ],
      pool
    );

    await replaceBaitsForScope(
      "single_man",
      [
        {
          body: "Itens essenciais masculinos",
          sort_order: 1,
        },
      ],
      pool
    );
  });

  after(async () => {
    await closePool();
    if (pool) await pool.end();
    if (container) await container.stop();
    fs.rmSync(tmpMediaDir, { recursive: true, force: true });
    fs.rmSync(tmpOutputDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM carousel_slides");
    await pool.query("DELETE FROM carousel_runs");
    await pool.query("DELETE FROM generation_jobs");
    await pool.query("DELETE FROM media_usage");
    await pool.query("DELETE FROM accounts");
    await pool.query("DELETE FROM app_settings");
  });

  describe("Step 1: generateBatch({}) only includes enabled accounts", () => {
    it("generateBatch({}) runs only for accounts where enabled = true", async () => {
      await upsertAccount(
        {
          id: "acc_active",
          role: "single_woman",
          enabled: true,
          persona: "Mulher jovem profissional",
        },
        pool
      );

      await upsertAccount(
        {
          id: "acc_disabled",
          role: "single_man",
          enabled: false,
          persona: "Homem clássico",
        },
        pool
      );

      const result = await generateBatch({
        pool,
        skipRender: true,
        mockCopy,
      });

      assert.equal(result.runs.length, 1);
      assert.equal(result.runs[0].account_id, "acc_active");
      assert.equal(result.job.total, 1);
      assert.deepEqual(result.job.account_ids, ["acc_active"]);
    });

    it("generateBatch({}) runs for all enabled accounts and skips disabled ones", async () => {
      await upsertAccount(
        {
          id: "acc_active_1",
          role: "single_woman",
          enabled: true,
        },
        pool
      );

      await upsertAccount(
        {
          id: "acc_active_2",
          role: "single_man",
          enabled: true,
        },
        pool
      );

      await upsertAccount(
        {
          id: "acc_disabled_1",
          role: "single_man",
          enabled: false,
        },
        pool
      );

      const result = await generateBatch({
        pool,
        skipRender: true,
        mockCopy,
      });

      assert.equal(result.runs.length, 2);
      const generatedIds = result.runs.map((r) => r.account_id);
      assert.ok(generatedIds.includes("acc_active_1"));
      assert.ok(generatedIds.includes("acc_active_2"));
      assert.ok(!generatedIds.includes("acc_disabled_1"));
    });
  });

  describe("Step 2: Automation cron wiring & auto_dispatch_enabled hook", () => {
    it("isAutoDispatchEnabled returns false when row is absent or false", async () => {
      const emptyCheck = await isAutoDispatchEnabled(pool);
      assert.equal(emptyCheck, false);

      await pool.query(
        `INSERT INTO app_settings (key, value) VALUES ('auto_dispatch_enabled', 'false'::jsonb)`
      );
      assert.equal(await isAutoDispatchEnabled(pool), false);

      await pool.query(
        `UPDATE app_settings SET value = 'true'::jsonb WHERE key = 'auto_dispatch_enabled'`
      );
      assert.equal(await isAutoDispatchEnabled(pool), true);
    });

    it("startCron wires automationTask on AUTOMATION_CRON_SCHEDULE, pollingTask, metricsTask and stop", () => {
      const task = startCron({
        pool,
        runBootTick: false,
        automationSchedule: "* * * * *",
        pollingSchedule: "*/2 * * * *",
        metricsSchedule: "0 4 * * *",
      });

      assert.ok(task);
      assert.ok(task.tasks);
      assert.ok(task.tasks.automationTask);
      assert.ok(task.tasks.pollingTask);
      assert.ok(task.tasks.metricsTask);
      assert.equal(typeof task.tasks.stop, "function");

      task.tasks.stop();
    });

    it("startCron rejects invalid cron expressions", () => {
      assert.throws(
        () =>
          startCron({
            pool,
            runBootTick: false,
            automationSchedule: "invalid-cron",
          }),
        /AUTOMATION_CRON_SCHEDULE inválido/
      );
    });
  });

  describe("Job lock & bot integration", () => {
    it("withJobLock prevents concurrent executions and exposes job status", async () => {
      assert.equal(getJobStatus().busy, false);

      let lockHeld = false;
      const promise1 = withJobLock(async () => {
        lockHeld = true;
        await new Promise((r) => setTimeout(r, 50));
        return { summary: "done" };
      });

      assert.equal(getJobStatus().busy, true);
      assert.equal(getJobStatus().state, "running");

      await assert.rejects(
        () =>
          withJobLock(async () => {
            return { summary: "secondary" };
          }),
        { code: "BUSY" }
      );

      await promise1;
      assert.equal(getJobStatus().busy, false);
      assert.equal(getJobStatus().state, "ok");
      assert.equal(getJobStatus().detail, "done");
    });

    it("createBot instantiates Bot when token is provided and handles permissions", () => {
      const nullBot = createBot({ token: "" });
      assert.equal(nullBot, null);

      const bot = createBot({
        token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        allowedUserIds: [999],
        pool,
      });
      assert.ok(bot);
    });
  });
});
