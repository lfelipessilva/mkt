import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveMediaForRole,
  unionImages,
  allMediaImageDirs,
  selectCarousel,
  selectCarouselForAccount,
  categoryPrefix,
  filenameStem,
} from "../../src/pipeline/select.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { getPool, closePool } from "../../src/shared/db/client.js";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import { replaceArchetypesForScope } from "../../src/domain/archetypes/store.js";
import { replaceBaitsForScope } from "../../src/domain/baits/store.js";

describe("pipeline: selection with role scopes", () => {
  let tmpMediaRoot: string;

  before(async () => {
    tmpMediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-select-test-"));

    // Set up directories
    const dirs = [
      path.join(tmpMediaRoot, "single_woman", "capas"),
      path.join(tmpMediaRoot, "single_woman", "aleatorias"),
      path.join(tmpMediaRoot, "single_man", "capas"),
      path.join(tmpMediaRoot, "single_man", "aleatorias"),
      path.join(tmpMediaRoot, "shared", "aleatorias"),
      path.join(tmpMediaRoot, "shared", "listo"),
    ];
    for (const d of dirs) {
      fs.mkdirSync(d, { recursive: true });
    }

    // Populate dummy images
    fs.writeFileSync(path.join(tmpMediaRoot, "single_woman", "capas", "capa_w1.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaRoot, "single_woman", "capas", "capa_w2.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaRoot, "single_woman", "aleatorias", "mercado_01.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaRoot, "single_woman", "aleatorias", "casa_01.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaRoot, "single_woman", "aleatorias", "dupe_01.jpg"), "dummy");

    fs.writeFileSync(path.join(tmpMediaRoot, "single_man", "capas", "capa_m1.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaRoot, "single_man", "aleatorias", "carro_01.jpg"), "dummy");

    fs.writeFileSync(path.join(tmpMediaRoot, "shared", "aleatorias", "dupe_01.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaRoot, "shared", "aleatorias", "livro_01.jpg"), "dummy");
    fs.writeFileSync(path.join(tmpMediaRoot, "shared", "listo", "listo_01.png"), "dummy");
    fs.writeFileSync(path.join(tmpMediaRoot, "shared", "listo", "listo_02.png"), "dummy");
  });

  after(() => {
    if (tmpMediaRoot && fs.existsSync(tmpMediaRoot)) {
      fs.rmSync(tmpMediaRoot, { recursive: true, force: true });
    }
  });

  describe("resolveMediaForRole & directory mapping", () => {
    it("resolves paths for valid account_role enum", () => {
      const dirs = resolveMediaForRole(tmpMediaRoot, "single_woman");
      assert.equal(dirs.capas, path.join(tmpMediaRoot, "single_woman", "capas"));
      assert.equal(dirs.aleatoriasRole, path.join(tmpMediaRoot, "single_woman", "aleatorias"));
      assert.equal(dirs.aleatoriasShared, path.join(tmpMediaRoot, "shared", "aleatorias"));
      assert.equal(dirs.listo, path.join(tmpMediaRoot, "shared", "listo"));
    });

    it("throws for invalid or legacy mediaRole strings", () => {
      assert.throws(() => {
        // @ts-expect-error test runtime validation
        resolveMediaForRole(tmpMediaRoot, "mulher");
      }, /role inválido/);

      assert.throws(() => {
        // @ts-expect-error test runtime validation
        resolveMediaForRole(tmpMediaRoot, "unknown");
      }, /role inválido/);
    });

    it("allMediaImageDirs includes all 4 account roles and shared aleatorias", () => {
      const dirs = allMediaImageDirs(tmpMediaRoot);
      assert.equal(dirs.length, 5);
      assert.ok(dirs.includes(path.join(tmpMediaRoot, "single_man", "aleatorias")));
      assert.ok(dirs.includes(path.join(tmpMediaRoot, "single_woman", "aleatorias")));
      assert.ok(dirs.includes(path.join(tmpMediaRoot, "couple_men", "aleatorias")));
      assert.ok(dirs.includes(path.join(tmpMediaRoot, "couple_women", "aleatorias")));
      assert.ok(dirs.includes(path.join(tmpMediaRoot, "shared", "aleatorias")));
    });
  });

  describe("unionImages & helpers", () => {
    it("deduplicates images across pools by filename", () => {
      const pool1 = [{ filename: "a.jpg", path: "/1/a.jpg" }, { filename: "b.jpg", path: "/1/b.jpg" }];
      const pool2 = [{ filename: "b.jpg", path: "/2/b.jpg" }, { filename: "c.jpg", path: "/2/c.jpg" }];
      const res = unionImages(pool1, pool2);
      assert.equal(res.length, 3);
      assert.deepEqual(res.map((r) => r.filename), ["a.jpg", "b.jpg", "c.jpg"]);
      // First pool wins on path
      assert.equal(res[1].path, "/1/b.jpg");
    });

    it("extracts filename stem and category prefix", () => {
      assert.equal(filenameStem("mercado_02.png"), "mercado_02");
      assert.equal(categoryPrefix("mercado_02.png"), "mercado");
      assert.equal(categoryPrefix("sozinha.jpg"), "sozinha");
    });
  });

  describe("selectCarousel role scoping behavior", () => {
    it("selects capas from role only, aleatorias from role ∪ shared, and listo from shared only", () => {
      const archetypes = ["Compre aos poucos e economize", "Segredos do mercado"];
      const baits = ["Você nunca percebeu isso?"];

      const selection = selectCarousel({
        mediaRoot: tmpMediaRoot,
        role: "single_woman",
        archetypes,
        baits,
        persona: "Mulher jovem independente",
        accountId: "test_acc",
        aleatoriasCount: 3,
      });

      assert.ok(selection);
      assert.equal(selection.role, "single_woman");
      assert.equal(selection.accountId, "test_acc");
      assert.ok(archetypes.includes(selection.arquetipoTitulo));

      // Slides inspection
      const slides = selection.slides;
      assert.ok(slides.length >= 4);

      // Slide 1 must be capa from single_woman
      const capaSlide = slides[0];
      assert.equal(capaSlide.numero, 1);
      assert.equal(capaSlide.isCapa, true);
      assert.ok(capaSlide.path.includes(path.join("single_woman", "capas")));

      // Exactly one listo slide from shared/listo
      const listoSlides = slides.filter((s) => s.isListo);
      assert.equal(listoSlides.length, 1);
      assert.ok(listoSlides[0].path.includes(path.join("shared", "listo")));

      // Aleatorias slides should only be from single_woman/aleatorias or shared/aleatorias
      const aleatoriaSlides = slides.filter((s) => !s.isCapa && !s.isListo);
      assert.equal(aleatoriaSlides.length, 3);
      for (const s of aleatoriaSlides) {
        const fromRole = s.path.includes(path.join("single_woman", "aleatorias"));
        const fromShared = s.path.includes(path.join("shared", "aleatorias"));
        assert.ok(fromRole || fromShared, `Slide ${s.filename} came from invalid path ${s.path}`);
        assert.ok(!s.path.includes("single_man"), "Must not leak from other roles");
      }
    });

    it("throws if archetypes array is empty or missing", () => {
      assert.throws(() => {
        selectCarousel({
          mediaRoot: tmpMediaRoot,
          role: "single_woman",
          archetypes: [],
          baits: [],
          accountId: "empty_account",
        });
      }, /arquétipos ausentes/);
    });

    it("throws if role has insufficient media", () => {
      assert.throws(() => {
        selectCarousel({
          mediaRoot: tmpMediaRoot,
          role: "couple_men", // empty folder
          archetypes: ["Título 1"],
          baits: [],
        });
      }, /mídia insuficiente/);
    });

    it("respects usage exclusion when available", () => {
      const archetypes = ["Título teste"];
      const usage = {
        entries: [{ filename: "capa_w1.jpg", at: new Date().toISOString() }],
        baits: [],
      };

      const selection = selectCarousel({
        mediaRoot: tmpMediaRoot,
        role: "single_woman",
        archetypes,
        baits: [],
        usage,
        usageDays: 7,
      });

      // Since capa_w1 was used, capa_w2 must be picked
      assert.equal(selection.slides[0].filename, "capa_w2.jpg");
    });
  });

  describe("selectCarouselForAccount with DB effective content", () => {
    let container: StartedPostgreSqlContainer | null = null;
    let pool: pg.Pool;

    before(async () => {
      let connectionString = process.env.DATABASE_URL;

      if (!connectionString) {
        container = await new PostgreSqlContainer("postgres:16-alpine").start();
        connectionString = container.getConnectionUri();
        process.env.DATABASE_URL = connectionString;
      }

      pool = new pg.Pool({ connectionString });
      await runMigrations(pool);
    });

    after(async () => {
      await closePool();
      if (pool) {
        await pool.end();
      }
      if (container) {
        await container.stop();
      }
    });

    it("loads account role, merged archetypes & baits, and returns selection", async () => {
      await upsertAccount(
        {
          id: "acc_select_test",
          persona: "Mulher jovem econômica",
          role: "single_woman",
          enabled: true,
        },
        pool
      );

      // Seed shared and role archetypes
      await replaceArchetypesForScope(
        "shared",
        [{ title: "Shared Title 1", sort_order: 1, active: true }],
        pool
      );
      await replaceArchetypesForScope(
        "single_woman",
        [{ title: "Role Title 1", sort_order: 1, active: true }],
        pool
      );

      await replaceBaitsForScope(
        "shared",
        [{ body: "Shared Bait 1", sort_order: 1, active: true }],
        pool
      );

      const selection = await selectCarouselForAccount("acc_select_test", {
        mediaRoot: tmpMediaRoot,
        pool,
        aleatoriasCount: 3,
      });

      assert.equal(selection.role, "single_woman");
      assert.equal(selection.accountId, "acc_select_test");
      assert.equal(selection.persona, "Mulher jovem econômica");
      assert.ok(
        selection.arquetipoTitulo === "Shared Title 1" ||
          selection.arquetipoTitulo === "Role Title 1"
      );
      assert.equal(selection.slides.length, 5); // 1 capa + 3 aleatorias + 1 listo
    });

    it("throws 404 AppError if account does not exist", async () => {
      await assert.rejects(
        async () => {
          await selectCarouselForAccount("non_existent_account", {
            mediaRoot: tmpMediaRoot,
            pool,
          });
        },
        { name: "AppError", statusCode: 404 }
      );
    });
  });
});
