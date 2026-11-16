import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  scopeToDir,
  validCategoriesForScope,
  MEDIA_SCOPES,
  MEDIA_CATEGORIES,
  toPortableOutputPath,
  isCarouselStoragePath,
  parseSiloMediaKey,
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
    test("valid categories for shared include random only", () => {
      const sharedCategories = validCategoriesForScope("shared");
      assert.deepEqual(Array.from(sharedCategories), ["random"]);
    });

    test("valid categories for role scopes include cover and random only", () => {
      const womanCategories = validCategoriesForScope("single_woman");
      assert.deepEqual(Array.from(womanCategories), ["cover", "random"]);
    });

    test("MEDIA_CATEGORIES defines cover, random, listo only", () => {
      assert.deepEqual(Array.from(MEDIA_CATEGORIES), ["cover", "random", "listo"]);
    });
  });

  describe("parseSiloMediaKey", () => {
    test("parses role/category/file and listo keys", () => {
      assert.deepEqual(parseSiloMediaKey("couple_women/random/foto.jpg"), {
        scope: "couple_women",
        category: "random",
        filename: "foto.jpg",
        storage_path: "media/couple_women/random/foto.jpg",
      });
      assert.deepEqual(parseSiloMediaKey("shared/aleatorias/old.jpg"), {
        scope: "shared",
        category: "random",
        filename: "old.jpg",
        storage_path: "media/shared/random/old.jpg",
      });
      assert.deepEqual(parseSiloMediaKey("listo/brand.png"), {
        scope: "listo",
        category: "listo",
        filename: "brand.png",
        storage_path: "media/listo/brand.png",
      });
      assert.equal(parseSiloMediaKey("readme.txt"), null);
      assert.equal(parseSiloMediaKey("unknown/cover/x.jpg"), null);
    });
  });

  describe("portable output paths", () => {
    test("toPortableOutputPath stores output/ relative keys", () => {
      assert.equal(
        toPortableOutputPath("/app/backend/output/2026-11-16/acc/post_01", "/app/backend/output"),
        "output/2026-11-16/acc/post_01"
      );
      assert.equal(
        toPortableOutputPath(
          "/app/backend/output/2026-11-16/acc/post_01/slide_2.jpg",
          "/app/backend/output"
        ),
        "output/2026-11-16/acc/post_01/slide_2.jpg"
      );
    });

    test("isCarouselStoragePath detects absolute and portable output paths", () => {
      assert.equal(isCarouselStoragePath("output/2026-11-16/acc/post_01/slide_1.jpg"), true);
      assert.equal(isCarouselStoragePath("/app/backend/output/2026-11-16/acc/post_01/slide_1.jpg"), true);
      assert.equal(isCarouselStoragePath("media/shared/random/x.jpg"), false);
    });
  });
});
