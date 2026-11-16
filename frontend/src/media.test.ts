import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_CATEGORIES_FOR_SCOPE,
  MEDIA_CATEGORIES,
} from "./types";
import {
  getMedia,
  uploadMedia,
  deleteMedia,
  getMediaFileUrl,
  fetchMediaBlob,
  setToken,
  clearToken,
} from "./api";

describe("Media library configuration & API", () => {
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = (globalThis as any).URL?.createObjectURL;
  const originalRevokeObjectURL = (globalThis as any).URL?.revokeObjectURL;

  beforeEach(() => {
    setToken("test-token-media");
  });

  afterEach(() => {
    clearToken();
    globalThis.fetch = originalFetch;
    if (originalCreateObjectURL) {
      (globalThis as any).URL.createObjectURL = originalCreateObjectURL;
    }
    if (originalRevokeObjectURL) {
      (globalThis as any).URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  describe("Categories by Scope", () => {
    it("defines valid categories for shared and role scopes", () => {
      assert.deepEqual(MEDIA_CATEGORIES, ["cover", "random", "listo"]);
      assert.deepEqual(MEDIA_CATEGORIES_FOR_SCOPE.shared, ["random"]);
      assert.deepEqual(MEDIA_CATEGORIES_FOR_SCOPE.single_man, ["cover", "random"]);
      assert.deepEqual(MEDIA_CATEGORIES_FOR_SCOPE.single_woman, ["cover", "random"]);
      assert.deepEqual(MEDIA_CATEGORIES_FOR_SCOPE.couple_men, ["cover", "random"]);
      assert.deepEqual(MEDIA_CATEGORIES_FOR_SCOPE.couple_women, ["cover", "random"]);
      assert.deepEqual(MEDIA_CATEGORIES_FOR_SCOPE.listo, ["listo"]);
    });

    it("generates correct media file url", () => {
      const url = getMediaFileUrl("media/shared/random/image1.jpg");
      assert.equal(
        url,
        "/api/v1/media/file?path=media%2Fshared%2Frandom%2Fimage1.jpg"
      );
    });
  });

  describe("Media API functions", () => {
    it("getMedia calls GET /api/v1/media with scope and category query params", async () => {
      let requestedUrl = "";
      let requestedHeaders: Headers | undefined;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedHeaders = new Headers(init?.headers);

        return new Response(
          JSON.stringify([
            {
              id: "media_1",
              scope: "single_woman",
              category: "cover",
              storage_path: "media/single_woman/cover/capa1.jpg",
              filename: "capa1.jpg",
              byte_size: 10240,
              width: 1080,
              height: 1920,
              active: true,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await getMedia({ scope: "single_woman", category: "cover" });

      assert.equal(
        requestedUrl,
        "/api/v1/media?scope=single_woman&category=cover"
      );
      assert.equal(requestedHeaders?.get("Authorization"), "Bearer test-token-media");
      assert.equal(result.length, 1);
      assert.equal(result[0].filename, "capa1.jpg");
      assert.equal(result[0].width, 1080);
    });

    it("uploadMedia sends multipart POST /api/v1/media/upload", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedHeaders: Headers | undefined;
      let requestedBody: any;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "GET";
        requestedHeaders = new Headers(init?.headers);
        requestedBody = init?.body;

        return new Response(
          JSON.stringify({
            id: "media_uploaded",
            scope: "shared",
            category: "random",
            storage_path: "media/shared/random/new.png",
            filename: "new.png",
            byte_size: 500,
            width: 800,
            height: 600,
            active: true,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      };

      const fakeFile = new Blob(["test-image-content"], {
        type: "image/png",
      }) as any;
      fakeFile.name = "new.png";

      const result = await uploadMedia(fakeFile, "shared", "random");

      assert.equal(requestedUrl, "/api/v1/media/upload");
      assert.equal(requestedMethod, "POST");
      assert.equal(requestedHeaders?.get("Authorization"), "Bearer test-token-media");
      // Form data body
      assert.equal(requestedBody instanceof FormData, true);
      assert.equal(result.id, "media_uploaded");
      assert.equal(result.filename, "new.png");
    });

    it("deleteMedia calls DELETE /api/v1/media with storage_path", async () => {
      let requestedUrl = "";
      let requestedMethod = "";
      let requestedBody = "";

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedMethod = init?.method ?? "GET";
        requestedBody = String(init?.body);

        return new Response(
          JSON.stringify({ ok: true, deleted: "media/shared/random/old.png" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const result = await deleteMedia("media/shared/random/old.png");

      assert.equal(requestedUrl, "/api/v1/media");
      assert.equal(requestedMethod, "DELETE");
      assert.deepEqual(JSON.parse(requestedBody), {
        storage_path: "media/shared/random/old.png",
      });
      assert.equal(result.ok, true);
    });

    it("fetchMediaBlob requests with Bearer token and returns an Object URL", async () => {
      let requestedUrl = "";
      let requestedHeaders: Headers | undefined;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedHeaders = new Headers(init?.headers);

        return new Response(new Blob(["mock-image-bytes"], { type: "image/jpeg" }), {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        });
      };

      (globalThis as any).URL.createObjectURL = (_blob: Blob) => "blob:http://localhost/mock-uuid";

      const blobUrl = await fetchMediaBlob("media/single_man/cover/capa.jpg");

      assert.equal(
        requestedUrl,
        "/api/v1/media/file?path=media%2Fsingle_man%2Fcover%2Fcapa.jpg"
      );
      assert.equal(requestedHeaders?.get("Authorization"), "Bearer test-token-media");
      assert.equal(blobUrl, "blob:http://localhost/mock-uuid");
    });
  });
});
