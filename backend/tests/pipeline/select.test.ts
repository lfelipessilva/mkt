import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  unionImages,
  selectCarousel,
  selectCarouselForAccount,
  categoryPrefix,
  filenameStem,
} from "../../src/pipeline/select.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { closePool } from "../../src/shared/db/client.js";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { upsertAccount } from "../../src/domain/accounts/store.js";
import { replaceArchetypesForScope } from "../../src/domain/archetypes/store.js";
import { replaceBaitsForScope } from "../../src/domain/baits/store.js";
import { upsertMediaAsset } from "../../src/domain/media/store.js";

describe("pipeline: selection with role scopes & media_assets DB", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;

  before(async () => {
    let connectionString = process.env.TEST_DATABASE_URL;

    if (!connectionString) {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      connectionString = container.getConnectionUri();
      process.env.DATABASE_URL = connectionString;
    }

    pool = new pg.Pool({ connectionString });
    await runMigrations(pool);

    // Seed test media assets into media_assets table
    // single_woman cover
    await upsertMediaAsset(
      {
        scope: "single_woman",
        category: "cover",
        storage_path: "media/single_woman/cover/cover_w1.jpg",
        filename: "cover_w1.jpg",
      },
      pool
    );
    await upsertMediaAsset(
      {
        scope: "single_woman",
        category: "cover",
        storage_path: "media/single_woman/cover/cover_w2.jpg",
        filename: "cover_w2.jpg",
      },
      pool
    );

    // single_woman random
    await upsertMediaAsset(
      {
        scope: "single_woman",
        category: "random",
        storage_path: "media/single_woman/random/mercado_01.jpg",
        filename: "mercado_01.jpg",
      },
      pool
    );
    await upsertMediaAsset(
      {
        scope: "single_woman",
        category: "random",
        storage_path: "media/single_woman/random/casa_01.jpg",
        filename: "casa_01.jpg",
      },
      pool
    );
    await upsertMediaAsset(
      {
        scope: "single_woman",
        category: "random",
        storage_path: "media/single_woman/random/dupe_01.jpg",
        filename: "dupe_01.jpg",
      },
      pool
    );

    // single_man cover & random (to verify role isolation)
    await upsertMediaAsset(
      {
        scope: "single_man",
        category: "cover",
        storage_path: "media/single_man/cover/cover_m1.jpg",
        filename: "cover_m1.jpg",
      },
      pool
    );
    await upsertMediaAsset(
      {
        scope: "single_man",
        category: "random",
        storage_path: "media/single_man/random/carro_01.jpg",
        filename: "carro_01.jpg",
      },
      pool
    );

    // shared random
    await upsertMediaAsset(
      {
        scope: "shared",
        category: "random",
        storage_path: "media/shared/random/dupe_01.jpg",
        filename: "dupe_01.jpg",
      },
      pool
    );
    await upsertMediaAsset(
      {
        scope: "shared",
        category: "random",
        storage_path: "media/shared/random/livro_01.jpg",
        filename: "livro_01.jpg",
      },
      pool
    );
    await upsertMediaAsset(
      {
        scope: "shared",
        category: "random",
        storage_path: "media/shared/random/cafe_01.jpg",
        filename: "cafe_01.jpg",
      },
      pool
    );

    // listo (scope "listo")
    await upsertMediaAsset(
      {
        scope: "listo",
        category: "listo",
        storage_path: "media/listo/listo_01.png",
        filename: "listo_01.png",
      },
      pool
    );
    await upsertMediaAsset(
      {
        scope: "listo",
        category: "listo",
        storage_path: "media/listo/listo_02.png",
        filename: "listo_02.png",
      },
      pool
    );
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

  describe("unionImages & helpers", () => {
    it("deduplicates images across pools by filename", () => {
      const pool1 = [
        { filename: "a.jpg", path: "media/shared/random/a.jpg" },
        { filename: "b.jpg", path: "media/1/random/b.jpg" },
      ];
      const pool2 = [
        { filename: "b.jpg", path: "media/2/random/b.jpg" },
        { filename: "c.jpg", path: "media/shared/random/c.jpg" },
      ];
      const res = unionImages(pool1, pool2);
      assert.equal(res.length, 3);
      assert.deepEqual(
        res.map((r) => r.filename),
        ["a.jpg", "b.jpg", "c.jpg"]
      );
      // First pool wins on path
      assert.equal(res[1].path, "media/1/random/b.jpg");
    });

    it("extracts filename stem and category prefix", () => {
      assert.equal(filenameStem("mercado_02.png"), "mercado_02");
      assert.equal(categoryPrefix("mercado_02.png"), "mercado");
      assert.equal(categoryPrefix("sozinha.jpg"), "sozinha");
    });
  });

  describe("selectCarousel role scoping behavior from DB", () => {
    it("selects cover from role only, random from role ∪ shared, and listo from listo scope", async () => {
      const archetypes = ["Compre aos poucos e economize", "Segredos do mercado"];
      const baits = ["Você nunca percebeu isso?"];

      const selection = await selectCarousel({
        pool,
        role: "single_woman",
        archetypes,
        baits,
        persona: "Mulher jovem independente",
        accountId: "test_acc",
        randomCount: 3,
      });

      assert.ok(selection);
      assert.equal(selection.role, "single_woman");
      assert.equal(selection.accountId, "test_acc");
      assert.ok(archetypes.includes(selection.arquetipoTitulo));

      // Slides inspection
      const slides = selection.slides;
      assert.equal(slides.length, 5); // 1 cover + 3 random + 1 listo

      // Slide 1 must be cover from single_woman
      const coverSlide = slides[0];
      assert.equal(coverSlide.numero, 1);
      assert.equal(coverSlide.isCapa, true);
      assert.ok(
        coverSlide.path.startsWith("media/single_woman/cover/"),
        `cover path was ${coverSlide.path}`
      );

      // Exactly one listo slide from listo
      const listoSlides = slides.filter((s) => s.isListo);
      assert.equal(listoSlides.length, 1);
      assert.ok(
        listoSlides[0].path.startsWith("media/listo/"),
        `listo path was ${listoSlides[0].path}`
      );

      // Random slides should only be from single_woman/random or shared/random
      const randomSlides = slides.filter((s) => !s.isCapa && !s.isListo);
      assert.equal(randomSlides.length, 3);
      for (const s of randomSlides) {
        const fromRole = s.path.startsWith("media/single_woman/random/");
        const fromShared = s.path.startsWith("media/shared/random/");
        assert.ok(
          fromRole || fromShared,
          `Slide ${s.filename} came from invalid path ${s.path}`
        );
        assert.ok(!s.path.includes("single_man"), "Must not leak from other roles");
      }

      // Check each slide path matches storage_path
      for (const s of slides) {
        assert.ok(s.path.startsWith("media/"), `Path must be storage_path, got ${s.path}`);
      }
    });

    it("throws if archetypes array is empty or missing", async () => {
      await assert.rejects(async () => {
        await selectCarousel({
          pool,
          role: "single_woman",
          archetypes: [],
          baits: [],
          accountId: "empty_account",
        });
      }, /arquétipos ausentes/);
    });

    it("throws if role has insufficient media with cover/random/listo message", async () => {
      await assert.rejects(
        async () => {
          await selectCarousel({
            pool,
            role: "couple_men", // no media seeded for couple_men
            archetypes: ["Título 1"],
            baits: [],
          });
        },
        (err: any) => {
          assert.match(err.message, /mídia insuficiente/);
          assert.match(err.message, /cover=0/);
          assert.match(err.message, /random=/);
          assert.match(err.message, /listo=/);
          return true;
        }
      );
    });

    it("respects usage exclusion when available", async () => {
      const archetypes = ["Título teste"];
      const usage = {
        entries: [{ filename: "cover_w1.jpg", at: new Date().toISOString() }],
        baits: [],
      };

      const selection = await selectCarousel({
        pool,
        role: "single_woman",
        archetypes,
        baits: [],
        usage,
        usageDays: 7,
      });

      // Since cover_w1 was used, cover_w2 must be picked
      assert.equal(selection.slides[0].filename, "cover_w2.jpg");
    });

    it("supports randomCount parameter with aleatoriasCount backwards-compat alias", async () => {
      const archetypes = ["Título teste"];
      const selectionWithRandom = await selectCarousel({
        pool,
        role: "single_woman",
        archetypes,
        randomCount: 3,
      });
      assert.equal(selectionWithRandom.slides.length, 5);

      const selectionWithAleatorias = await selectCarousel({
        pool,
        role: "single_woman",
        archetypes,
        aleatoriasCount: 3,
      });
      assert.equal(selectionWithAleatorias.slides.length, 5);
    });
  });

  describe("selectCarouselForAccount with DB effective content", () => {
    it("loads account role, merged archetypes & baits, and returns selection from media_assets", async () => {
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
        pool,
        randomCount: 3,
      });

      assert.equal(selection.role, "single_woman");
      assert.equal(selection.accountId, "acc_select_test");
      assert.equal(selection.persona, "Mulher jovem econômica");
      assert.ok(
        selection.arquetipoTitulo === "Shared Title 1" ||
          selection.arquetipoTitulo === "Role Title 1"
      );
      assert.equal(selection.slides.length, 5); // 1 cover + 3 random + 1 listo
      assert.ok(selection.slides[0].path.startsWith("media/single_woman/cover/"));
    });

    it("throws 404 AppError if account does not exist", async () => {
      await assert.rejects(
        async () => {
          await selectCarouselForAccount("non_existent_account", {
            pool,
          });
        },
        { name: "AppError", statusCode: 404 }
      );
    });
  });
});
