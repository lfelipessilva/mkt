import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { BufferPublisherAdapter } from "../../src/domain/social/providers/buffer.js";
import { AppError } from "../../src/shared/errors.js";

describe("BufferPublisherAdapter", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.BUFFER_ACCESS_TOKEN = "test-buffer-token";
    process.env.BUFFER_API_URL = "https://api.buffer.com";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  describe("listConnectedAccounts", () => {
    it("filters channels where service === 'tiktok' and maps channel.id to externalAccountId", async () => {
      let capturedUrl = "";
      let capturedOptions: any = null;

      globalThis.fetch = async (url: any, options: any) => {
        capturedUrl = url.toString();
        capturedOptions = options;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              account: {
                organizations: [
                  {
                    channels: [
                      {
                        id: "chan_instagram",
                        service: "instagram",
                        name: "InstaProfile",
                        serviceUsername: "instaprofile",
                      },
                      {
                        id: "chan_tiktok_1",
                        service: "tiktok",
                        name: "TikTokProfile1",
                        serviceUsername: "tiktok_user_1",
                      },
                      {
                        id: "chan_tiktok_2",
                        service: "tiktok",
                        name: "TikTokProfile2",
                        serviceUsername: null,
                      },
                    ],
                  },
                ],
              },
            },
          }),
        } as any;
      };

      const adapter = new BufferPublisherAdapter();
      const accounts = await adapter.listConnectedAccounts();

      assert.equal(capturedUrl, "https://api.buffer.com");
      assert.equal(capturedOptions.method, "POST");
      assert.equal(capturedOptions.headers["Authorization"], "Bearer test-buffer-token");
      assert.equal(capturedOptions.headers["Content-Type"], "application/json");

      assert.equal(accounts.length, 2);
      assert.deepEqual(accounts[0], {
        internalAccountId: "chan_tiktok_1",
        provider: "buffer",
        externalAccountId: "chan_tiktok_1",
        username: "tiktok_user_1",
        service: "tiktok",
        isActive: true,
      });
      assert.deepEqual(accounts[1], {
        internalAccountId: "chan_tiktok_2",
        provider: "buffer",
        externalAccountId: "chan_tiktok_2",
        username: "TikTokProfile2",
        service: "tiktok",
        isActive: true,
      });
    });

    it("enforces max 3 active accounts guardrail (Free tier)", async () => {
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              account: {
                organizations: [
                  {
                    channels: [
                      { id: "tt1", service: "tiktok", name: "tt1", serviceUsername: "tt1" },
                      { id: "tt2", service: "tiktok", name: "tt2", serviceUsername: "tt2" },
                      { id: "tt3", service: "tiktok", name: "tt3", serviceUsername: "tt3" },
                      { id: "tt4", service: "tiktok", name: "tt4", serviceUsername: "tt4" },
                    ],
                  },
                ],
              },
            },
          }),
        } as any;
      };

      const adapter = new BufferPublisherAdapter();
      await assert.rejects(
        async () => adapter.listConnectedAccounts(),
        (err: any) => {
          assert.equal(err instanceof AppError, true);
          assert.equal(err.code, "buffer_account_limit_exceeded");
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    });
  });

  describe("publishPost", () => {
    it("maps carousel imageUrls to assets: [{ image: { url } }] and uses mode: shareNow for immediate", async () => {
      let capturedBody: any = null;

      globalThis.fetch = async (_url: any, options: any) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              createPost: {
                post: {
                  id: "post_123",
                  status: "sent",
                  dueAt: null,
                },
              },
            },
          }),
        } as any;
      };

      const adapter = new BufferPublisherAdapter();
      const res = await adapter.publishPost({
        internalPostId: "int_post_1",
        externalAccountId: "chan_tiktok_1",
        caption: "Test caption #marketing",
        media: {
          type: "carousel",
          imageUrls: [
            "https://personal-minio.adaygq.easypanel.host/carousels/slide_1.jpg",
            "https://personal-minio.adaygq.easypanel.host/carousels/slide_2.jpg",
          ],
        },
        publishMode: "immediate",
      });

      assert.equal(res.externalPostId, "post_123");
      assert.equal(res.status, "published");
      assert.deepEqual(capturedBody.variables.input, {
        channelId: "chan_tiktok_1",
        text: "Test caption #marketing",
        schedulingType: "automatic",
        mode: "shareNow",
        assets: [
          { image: { url: "https://personal-minio.adaygq.easypanel.host/carousels/slide_1.jpg" } },
          { image: { url: "https://personal-minio.adaygq.easypanel.host/carousels/slide_2.jpg" } },
        ],
      });
    });

    it("maps scheduled mode to customScheduled with dueAt ISO timestamp", async () => {
      let capturedBody: any = null;

      globalThis.fetch = async (_url: any, options: any) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              createPost: {
                post: {
                  id: "post_456",
                  status: "queued",
                  dueAt: "2026-11-20T12:00:00.000Z",
                },
              },
            },
          }),
        } as any;
      };

      const adapter = new BufferPublisherAdapter();
      const res = await adapter.publishPost({
        internalPostId: "int_post_2",
        externalAccountId: "chan_tiktok_1",
        caption: "Scheduled post",
        media: {
          type: "video",
          videoUrl: "https://personal-minio.adaygq.easypanel.host/carousels/video.mp4",
          thumbnailOffsetMs: 1500,
        },
        publishMode: "scheduled",
        scheduledAt: "2026-11-20T12:00:00.000Z",
      });

      assert.equal(res.externalPostId, "post_456");
      assert.equal(res.status, "queued");
      assert.deepEqual(capturedBody.variables.input, {
        channelId: "chan_tiktok_1",
        text: "Scheduled post",
        schedulingType: "automatic",
        mode: "customScheduled",
        dueAt: "2026-11-20T12:00:00.000Z",
        assets: [
          { video: { url: "https://personal-minio.adaygq.easypanel.host/carousels/video.mp4" } },
        ],
        metadata: {
          tiktok: {
            thumbnailOffset: 1500,
          },
        },
      });
    });

    it("handles GraphQL MutationError in createPost and returns failed status with message", async () => {
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              createPost: {
                message: "Channel queue limit exceeded (max 10)",
              },
            },
          }),
        } as any;
      };

      const adapter = new BufferPublisherAdapter();
      const res = await adapter.publishPost({
        internalPostId: "int_post_3",
        externalAccountId: "chan_tiktok_1",
        caption: "Failing post",
        media: {
          type: "carousel",
          imageUrls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
        },
        publishMode: "immediate",
      });

      assert.equal(res.status, "failed");
      assert.equal(res.errorMessage, "Channel queue limit exceeded (max 10)");
    });
  });

  describe("getPostStatus", () => {
    it("maps Buffer status 'sent' to 'published' and handles sentAt", async () => {
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              post: {
                id: "post_100",
                status: "sent",
                sentAt: "2026-11-15T20:00:00.000Z",
                error: null,
              },
            },
          }),
        } as any;
      };

      const adapter = new BufferPublisherAdapter();
      const status = await adapter.getPostStatus("post_100");

      assert.equal(status.externalPostId, "post_100");
      assert.equal(status.status, "published");
      assert.equal(status.publishedAt, "2026-11-15T20:00:00.000Z");
    });

    it("maps Buffer status 'failed' to 'failed' with error message", async () => {
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              post: {
                id: "post_101",
                status: "failed",
                sentAt: null,
                error: {
                  message: "TikTok API rejected video format",
                },
              },
            },
          }),
        } as any;
      };

      const adapter = new BufferPublisherAdapter();
      const status = await adapter.getPostStatus("post_101");

      assert.equal(status.externalPostId, "post_101");
      assert.equal(status.status, "failed");
      assert.equal(status.errorMessage, "TikTok API rejected video format");
    });
  });

  describe("getPostMetrics", () => {
    it("maps metrics list (impressions -> views, reactions -> likes, comments, shares)", async () => {
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              post: {
                id: "post_200",
                sentAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
                metrics: [
                  { type: "impressions", value: 12500 },
                  { type: "reactions", value: 430 },
                  { type: "comments", value: 25 },
                  { type: "shares", value: 18 },
                ],
                metricsUpdatedAt: "2026-11-15T21:00:00.000Z",
              },
            },
          }),
        } as any;
      };

      const adapter = new BufferPublisherAdapter();
      const metrics = await adapter.getPostMetrics("post_200");

      assert.notEqual(metrics, null);
      assert.equal(metrics?.externalPostId, "post_200");
      assert.equal(metrics?.views, 12500);
      assert.equal(metrics?.likes, 430);
      assert.equal(metrics?.comments, 25);
      assert.equal(metrics?.shares, 18);
    });

    it("30-day window check: getPostMetrics() rejects/skips posts older than 30 days", async () => {
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              post: {
                id: "post_old",
                sentAt: new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString(), // 35 days ago
                metrics: [{ type: "impressions", value: 500 }],
                metricsUpdatedAt: "2026-10-01T00:00:00.000Z",
              },
            },
          }),
        } as any;
      };

      const adapter = new BufferPublisherAdapter();
      const metrics = await adapter.getPostMetrics("post_old");
      assert.equal(metrics, null);
    });
  });

  describe("Rate limiting and retry", () => {
    it("retries on HTTP 429 with backoff and succeeds on subsequent try", async () => {
      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            headers: new Headers({ "Retry-After": "0" }),
            text: async () => "Rate limit exceeded",
          } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              post: {
                id: "post_300",
                status: "sent",
                sentAt: "2026-11-15T22:00:00.000Z",
                error: null,
              },
            },
          }),
        } as any;
      };

      const adapter = new BufferPublisherAdapter({ maxRetries: 2, baseDelayMs: 10 });
      const status = await adapter.getPostStatus("post_300");

      assert.equal(callCount, 2);
      assert.equal(status.status, "published");
    });

    it("throws AppError on HTTP 429 when max retries are exceeded", async () => {
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 429,
          headers: new Headers(),
          text: async () => "Rate limit exceeded",
        } as any;
      };

      const adapter = new BufferPublisherAdapter({ maxRetries: 1, baseDelayMs: 10 });
      await assert.rejects(
        async () => adapter.getPostStatus("post_300"),
        (err: any) => {
          assert.equal(err instanceof AppError, true);
          assert.equal(err.code, "buffer_rate_limit_exceeded");
          assert.equal(err.statusCode, 429);
          return true;
        }
      );
    });
  });
});
