import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../src/shared/errors.js";
import {
  ZernioPublisherAdapter,
  musicSoundId,
  type ZernioSdk,
} from "../../src/domain/social/providers/zernio.js";

function client(partial: Partial<ZernioSdk>): ZernioSdk {
  return partial as ZernioSdk;
}

describe("ZernioPublisherAdapter", () => {
  it("uses apiKey provided to constructor over env", async () => {
    const adapter = new ZernioPublisherAdapter(undefined, "zk_custom_test_key");
    assert.strictEqual((adapter as any).apiKey, "zk_custom_test_key");
  });

  it("uses clip.id, then track id", () => {
    assert.equal(musicSoundId([{ id: "track", clip: { id: "clip" } }]), "clip");
    assert.equal(musicSoundId([{ id: "track" }]), "track");
    assert.equal(musicSoundId([]), null);
  });

  it("lists only active tiktok accounts", async () => {
    const adapter = new ZernioPublisherAdapter(
      client({
        accounts: {
          listAccounts: async () => ({
            data: {
              accounts: [
                { _id: "tt", platform: "tiktok", username: "@ada", isActive: true, enabled: true },
                { _id: "ig", platform: "instagram", username: "ig", isActive: true },
                { _id: "off", platform: "tiktok", username: "off", isActive: false },
              ],
            },
          }),
          listTikTokCommercialMusic: async () => ({ data: { tracks: [] } }),
        },
      })
    );
    const accounts = await adapter.listConnectedAccounts();
    assert.deepEqual(
      accounts.map((account) => account.externalAccountId),
      ["tt"]
    );
    assert.equal(accounts[0].provider, "zernio");
    assert.equal(accounts[0].username, "ada");
  });

  it("does not create a post when the chart has no track", async () => {
    let created = false;
    const adapter = new ZernioPublisherAdapter(
      client({
        accounts: {
          listAccounts: async () => ({ data: { accounts: [] } }),
          listTikTokCommercialMusic: async () => ({ data: { tracks: [] } }),
        },
        posts: {
          createPost: async () => {
            created = true;
            return { data: { post: { _id: "nope", status: "published" } } };
          },
          getPost: async () => ({ data: {} }),
        },
      })
    );
    await assert.rejects(
      () =>
        adapter.publishPost({
          internalPostId: "run",
          externalAccountId: "acc",
          caption: "oi",
          media: { type: "carousel", imageUrls: ["https://cdn.example/1.jpg", "https://cdn.example/2.jpg"] },
          publishMode: "immediate",
        }),
      (err: unknown) => err instanceof AppError && err.code === "zernio_music_required"
    );
    assert.equal(created, false);
  });

  it("publishes a photo carousel with the clip id", async () => {
    let body: Record<string, unknown> | undefined;
    const adapter = new ZernioPublisherAdapter(
      client({
        accounts: {
          listAccounts: async () => ({ data: { accounts: [] } }),
          listTikTokCommercialMusic: async () => ({
            data: { tracks: [{ id: "full", clip: { id: "clip-1" } }] },
          }),
        },
        posts: {
          createPost: async (options) => {
            body = options.body;
            return { data: { post: { _id: "post1", status: "scheduled" } } };
          },
          getPost: async () => ({ data: {} }),
        },
      })
    );
    const result = await adapter.publishPost({
      internalPostId: "run",
      externalAccountId: "acc",
      caption: "legenda",
      media: { type: "carousel", imageUrls: ["https://cdn.example/1.jpg"] },
      publishMode: "immediate",
    });
    assert.equal(result.externalPostId, "post1");
    assert.equal(result.status, "processing");
    const settings = body?.tiktokSettings as { media_type: string; musicSoundInfo: { musicSoundId: string } };
    assert.equal(settings.media_type, "photo");
    assert.equal(settings.musicSoundInfo.musicSoundId, "clip-1");
    assert.equal(body?.publishNow, true);
  });

  it("treats a partial post as published for this TikTok-only flow", async () => {
    const adapter = new ZernioPublisherAdapter(
      client({
        posts: {
          createPost: async () => ({ data: {} }),
          getPost: async () => ({ data: { post: { _id: "post-partial", status: "partial" } } }),
        },
      })
    );

    const status = await adapter.getPostStatus("post-partial");
    assert.equal(status.status, "published");
  });

  it("maps Zernio analytics into post metrics", async () => {
    const adapter = new ZernioPublisherAdapter(
      client({
        analytics: {
          getAnalytics: async (options) => {
            assert.equal(options?.query?.postId, "post-metrics");
            return {
              data: {
                postId: "post-metrics",
                syncStatus: "synced",
                analytics: {
                  views: 61,
                  likes: 6,
                  comments: 2,
                  shares: 3,
                  lastUpdated: "2026-11-16T22:32:14Z",
                },
                platformPostUrl: "https://www.tiktok.com/@rebeca.andrade.daily/video/7708859399561055495",
              },
            };
          },
        },
      })
    );

    const metrics = await adapter.getPostMetrics("post-metrics");
    assert.deepEqual(metrics, {
      externalPostId: "post-metrics",
      views: 61,
      likes: 6,
      comments: 2,
      shares: 3,
      saves: 0,
      collectedAt: "2026-11-16T22:32:14Z",
      postUrl: "https://www.tiktok.com/@rebeca.andrade.daily/video/7708859399561055495",
    });
  });

  it("does not overwrite metrics while Zernio still reports pending sync", async () => {
    const adapter = new ZernioPublisherAdapter(
      client({
        analytics: {
          getAnalytics: async () => ({
            data: {
              syncStatus: "pending",
              analytics: { views: 0, likes: 0, comments: 0, shares: 0 },
            },
          }),
        },
      })
    );

    assert.equal(await adapter.getPostMetrics("post-pending"), null);
  });

  it("does not overwrite metrics with a zeroed payload without sync timestamp", async () => {
    const adapter = new ZernioPublisherAdapter(
      client({
        analytics: {
          getAnalytics: async () => ({
            data: {
              syncStatus: "synced",
              analytics: { views: 0, likes: 0, comments: 0, shares: 0, lastUpdated: null },
            },
          }),
        },
      })
    );

    assert.equal(await adapter.getPostMetrics("post-zero"), null);
  });

  it("rejects video posts", async () => {
    const adapter = new ZernioPublisherAdapter(client({}));
    await assert.rejects(
      () =>
        adapter.publishPost({
          internalPostId: "run",
          externalAccountId: "acc",
          caption: "video",
          media: { type: "video", videoUrl: "https://cdn.example/v.mp4" },
          publishMode: "immediate",
        }),
      (err: unknown) => err instanceof AppError && err.code === "validation_error"
    );
  });
});
