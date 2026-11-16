import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  scopeToDir,
  validCategoriesForScope,
  MEDIA_SCOPES,
  MEDIA_CATEGORIES,
} from "../../src/domain/media/paths.js";

describe("media directory layout & paths", () => {
  describe("scopeToDir", () => {
    test("scopeToDir('shared') returns media/shared", () => {
      assert.equal(scopeToDir("shared"), "media/shared");
    });

    test("scopeToDir with custom base dir returns prefix/scope", () => {
      assert.equal(scopeToDir("shared", "/custom/base"), "/custom/base/shared");
      assert.equal(scopeToDir("single_woman", "assets"), "assets/single_woman");
    });

    test("maps all content scopes to media/<scope>", () => {
      assert.equal(scopeToDir("single_woman"), "media/single_woman");
      assert.equal(scopeToDir("single_man"), "media/single_man");
      assert.equal(scopeToDir("couple_men"), "media/couple_men");
      assert.equal(scopeToDir("couple_women"), "media/couple_women");
    });
  });

  describe("categories", () => {
    test("valid categories for shared include aleatorias and listo", () => {
      const sharedCategories = validCategoriesForScope("shared");
      assert.ok(sharedCategories.includes("aleatorias"));
      assert.ok(sharedCategories.includes("listo"));
    });

    test("valid categories for role scopes include capas and aleatorias", () => {
      const womanCategories = validCategoriesForScope("single_woman");
      assert.ok(womanCategories.includes("capas"));
      assert.ok(womanCategories.includes("aleatorias"));
      assert.ok(!womanCategories.includes("listo"));
    });

    test("MEDIA_CATEGORIES defines cover, random, listo, capas, aleatorias", () => {
      assert.ok(MEDIA_CATEGORIES.includes("cover"));
      assert.ok(MEDIA_CATEGORIES.includes("random"));
      assert.ok(MEDIA_CATEGORIES.includes("listo"));
      assert.ok(MEDIA_CATEGORIES.includes("capas"));
      assert.ok(MEDIA_CATEGORIES.includes("aleatorias"));
    });
  });

  describe("migrateMediaDirs plan & execution", () => {
    test("computeMediaMigrationPlans maps legacy directories to new role directories", async () => {
      const { computeMediaMigrationPlans } = await import(
        "../../scripts/migrate-media-dirs.js"
      );

      const plans = computeMediaMigrationPlans("/test/media");
      const mapped = new Map(plans.map((p: any) => [p.legacyDir, p]));

      assert.equal(mapped.get("mulher")?.targetScope, "single_woman");
      assert.equal(mapped.get("homem")?.targetScope, "single_man");
      assert.equal(mapped.get("casal")?.targetScope, "couple_women");
      assert.equal(mapped.get("casal")?.isAmbiguous, true);
    });

    test("executeMediaMigration physically moves legacy directories and logs ambiguous warning", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const os = await import("node:os");
      const { executeMediaMigration } = await import(
        "../../scripts/migrate-media-dirs.js"
      );

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "media-test-"));
      try {
        fs.mkdirSync(path.join(tmpDir, "mulher", "capas"), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "mulher", "capas", "test.jpg"), "dummy");

        fs.mkdirSync(path.join(tmpDir, "homem", "aleatorias"), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "homem", "aleatorias", "man.jpg"), "dummy");

        fs.mkdirSync(path.join(tmpDir, "casal", "capas"), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "casal", "capas", "couple.jpg"), "dummy");

        const logged: string[] = [];
        const warned: string[] = [];
        const logger = {
          log: (...args: any[]) => logged.push(args.join(" ")),
          warn: (...args: any[]) => warned.push(args.join(" ")),
        };

        const result = executeMediaMigration(tmpDir, logger);

        assert.equal(result.moved.length, 3);
        assert.equal(result.ambiguous.length, 1);
        assert.ok(warned.some((w) => w.includes("casal") && w.includes("couple_women")));

        assert.ok(!fs.existsSync(path.join(tmpDir, "mulher")));
        assert.ok(!fs.existsSync(path.join(tmpDir, "homem")));
        assert.ok(!fs.existsSync(path.join(tmpDir, "casal")));

        assert.ok(fs.existsSync(path.join(tmpDir, "single_woman", "capas", "test.jpg")));
        assert.ok(fs.existsSync(path.join(tmpDir, "single_man", "aleatorias", "man.jpg")));
        assert.ok(fs.existsSync(path.join(tmpDir, "couple_women", "capas", "couple.jpg")));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
