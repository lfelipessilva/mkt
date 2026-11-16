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
