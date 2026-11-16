import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getSiloConfig,
  isSiloEnabled,
  uploadMediaToSilo,
  deleteMediaFromSilo,
  uploadCarouselToSilo,
  getCarouselStreamFromSilo,
  getMediaStreamFromSilo,
} from "../../src/shared/storage/silo.js";

describe("Silo Storage Integration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SILO_SERVER_URL = "https://personal-minio.adaygq.easypanel.host";
    process.env.SILO_ACCESS_KEY = "test-access-key";
    process.env.SILO_SECRET_KEY = "test-secret-key";
    process.env.SILO_MEDIA_BUCKET = "media";
    process.env.SILO_CAROUSELS_BUCKET = "carousels";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("detects when Silo is enabled and parses configuration correctly", () => {
    assert.equal(isSiloEnabled(), true);

    const config = getSiloConfig();
    assert.ok(config);
    assert.equal(config.serverUrl, "https://personal-minio.adaygq.easypanel.host");
    assert.equal(config.accessKey, "test-access-key");
    assert.equal(config.secretKey, "test-secret-key");
    assert.equal(config.mediaBucket, "media");
    assert.equal(config.carouselsBucket, "carousels");
  });

  it("returns isSiloEnabled false when credentials are not configured", () => {
    delete process.env.SILO_ACCESS_KEY;
    delete process.env.SILO_SECRET_KEY;
    delete process.env.SILO_SERVER_URL;

    assert.equal(isSiloEnabled(), false);
    assert.equal(getSiloConfig(), null);
  });
});
