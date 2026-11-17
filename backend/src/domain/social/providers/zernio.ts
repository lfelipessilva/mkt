import { Zernio } from "@zernio/node";
import { AppError } from "../../../shared/errors.js";
import {
  SocialPublisherProvider,
  SocialAccount,
  PublishPostRequest,
  PublishPostResponse,
  PostMetrics,
  PublishStatus,
} from "../types.js";

type ZernioError = { error?: string; message?: string; code?: string };

export interface ZernioSdk {
  accounts: {
    listAccounts(options?: {
      query?: { profileId?: string; platform?: string };
    }): Promise<{ data?: { accounts?: ZernioListedAccount[] }; error?: ZernioError }>;
    listTikTokCommercialMusic(options: {
      path: { accountId: string };
    }): Promise<{ data?: { tracks?: ZernioTrack[] }; error?: ZernioError }>;
  };
  posts: {
    createPost(options: { body: Record<string, unknown> }): Promise<{
      data?: { post?: { _id?: string; status?: string } };
      error?: ZernioError;
    }>;
    getPost(options: { path: { postId: string } }): Promise<{
      data?: { post?: { _id?: string; status?: string } };
      error?: ZernioError;
    }>;
  };
  analytics: {
    getAnalytics(options?: { query?: { postId?: string } }): Promise<{
      data?: ZernioAnalyticsResponse;
      error?: ZernioError;
    }>;
  };
  connect: {
    getConnectUrl(options: {
      path: { platform: "tiktok" };
      query: { profileId: string };
    }): Promise<{ data?: { authUrl?: string }; error?: ZernioError }>;
  };
  profiles: {
    listProfiles(): Promise<{ data?: { profiles?: Array<{ _id?: string }> }; error?: ZernioError }>;
    createProfile(options: { body: { name: string } }): Promise<{
      data?: { profile?: { _id?: string }; _id?: string };
      error?: ZernioError;
    }>;
  };
}

interface ZernioListedAccount {
  _id?: string;
  id?: string;
  platform?: string;
  username?: string;
  displayName?: string;
  isActive?: boolean;
  enabled?: boolean;
}

interface ZernioTrack {
  id?: string;
  clip?: { id?: string };
}

interface ZernioPostAnalytics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  lastUpdated?: string | null;
}

interface ZernioAnalyticsResponse {
  postId?: string;
  status?: string;
  syncStatus?: "synced" | "pending" | "partial" | "unavailable";
  platformPostUrl?: string | null;
  analytics?: ZernioPostAnalytics | null;
  platformAnalytics?: Array<{
    platform?: string;
    analytics?: ZernioPostAnalytics | null;
    syncStatus?: string;
    platformPostUrl?: string | null;
  }>;
}

function fail(result: { error?: ZernioError }, fallback: string): void {
  if (!result.error) return;
  const message = result.error.error || result.error.message || fallback;
  throw new AppError(message, 502, "zernio_http_error");
}

export function musicSoundId(tracks: ZernioTrack[] | undefined): string | null {
  const first = tracks?.[0];
  if (!first) return null;
  return first.clip?.id || first.id || null;
}

function mapStatus(status: string | undefined): PublishStatus {
  if (status === "published" || status === "partial") return "published";
  if (status === "failed" || status === "cancelled") return "failed";
  return "processing";
}

export class ZernioPublisherAdapter implements SocialPublisherProvider {
  readonly providerName = "zernio" as const;

  constructor(private readonly client?: ZernioSdk) {}

  private sdk(): ZernioSdk {
    if (this.client) return this.client;
    const apiKey = process.env.ZERNIO_API_KEY;
    if (!apiKey) {
      throw new AppError("ZERNIO_API_KEY is not configured", 400, "zernio_config");
    }
    return new Zernio({ apiKey }) as unknown as ZernioSdk;
  }

  async resolveProfileId(): Promise<string> {
    const fromEnv = process.env.ZERNIO_PROFILE_ID?.trim();
    if (fromEnv) return fromEnv;
    const client = this.sdk();
    const listed = await client.profiles.listProfiles();
    fail(listed, "Zernio profiles failed");
    const existing = listed.data?.profiles?.find((profile) => profile._id)?._id;
    if (existing) return existing;
    const created = await client.profiles.createProfile({ body: { name: "Sander" } });
    fail(created, "Zernio create profile failed");
    const id = created.data?.profile?._id || created.data?._id;
    if (!id) throw new AppError("Zernio did not return a profile id", 502, "zernio_empty_response");
    return id;
  }

  async getTikTokConnectUrl(): Promise<string> {
    const profileId = await this.resolveProfileId();
    const result = await this.sdk().connect.getConnectUrl({
      path: { platform: "tiktok" },
      query: { profileId },
    });
    fail(result, "Zernio connect failed");
    if (!result.data?.authUrl) {
      throw new AppError("Zernio did not return an auth URL", 502, "zernio_empty_response");
    }
    return result.data.authUrl;
  }

  async listConnectedAccounts(): Promise<SocialAccount[]> {
    const profileId = process.env.ZERNIO_PROFILE_ID?.trim();
    const result = await this.sdk().accounts.listAccounts({
      query: {
        platform: "tiktok",
        ...(profileId ? { profileId } : {}),
      },
    });
    fail(result, "Zernio list accounts failed");
    const accounts = result.data?.accounts || [];
    return accounts
      .filter((account) => account.platform === "tiktok" && account.isActive !== false && account.enabled !== false)
      .map((account) => {
        const externalAccountId = account._id || account.id || "";
        const username = (account.username || account.displayName || externalAccountId).replace(/^@/, "");
        return {
          internalAccountId: username,
          provider: "zernio" as const,
          externalAccountId,
          username,
          service: "tiktok" as const,
          isActive: true,
        };
      })
      .filter((account) => account.externalAccountId);
  }

  private async requireMusic(accountId: string): Promise<string> {
    const result = await this.sdk().accounts.listTikTokCommercialMusic({
      path: { accountId },
    });
    fail(result, "Zernio commercial music failed");
    const id = musicSoundId(result.data?.tracks);
    if (!id) {
      throw new AppError(
        "Nenhuma faixa comercial disponível; o post não foi enviado",
        400,
        "zernio_music_required"
      );
    }
    return id;
  }

  async publishPost(request: PublishPostRequest): Promise<PublishPostResponse> {
    if (request.media.type !== "carousel") {
      throw new AppError("Só publicamos carrossel de imagens", 400, "validation_error");
    }
    const soundId = await this.requireMusic(request.externalAccountId);
    const mediaItems = request.media.imageUrls.map((url) => ({ type: "image", url }));

    const tiktokSettings: Record<string, unknown> = {
      privacy_level: "PUBLIC_TO_EVERYONE",
      allow_comment: true,
      allow_duet: true,
      allow_stitch: true,
      content_preview_confirmed: true,
      express_consent_given: true,
      media_type: "photo",
      photo_cover_index: 0,
      musicSoundInfo: { musicSoundId: soundId },
    };

    const body: Record<string, unknown> = {
      content: request.caption || "",
      mediaItems,
      platforms: [{ platform: "tiktok", accountId: request.externalAccountId }],
      tiktokSettings,
    };
    if (request.publishMode === "scheduled") {
      body.scheduledFor = request.scheduledAt;
    } else {
      body.publishNow = true;
    }

    const result = await this.sdk().posts.createPost({ body });
    fail(result, "Zernio create post failed");
    const post = result.data?.post;
    const externalPostId = post?._id;
    if (!externalPostId) {
      throw new AppError("Zernio did not return a post id", 502, "zernio_empty_response");
    }
    const status = mapStatus(post?.status);
    return {
      externalPostId,
      status,
      rawResponse: (result.data || {}) as Record<string, unknown>,
      publishedAt: status === "published" ? new Date().toISOString() : undefined,
      errorMessage: status === "failed" ? "Zernio post failed" : undefined,
    };
  }

  async getPostStatus(externalPostId: string): Promise<PublishPostResponse> {
    const result = await this.sdk().posts.getPost({ path: { postId: externalPostId } });
    fail(result, "Zernio get post failed");
    const post = result.data?.post;
    const status = mapStatus(post?.status);
    return {
      externalPostId: post?._id || externalPostId,
      status,
      rawResponse: (result.data || {}) as Record<string, unknown>,
      publishedAt: status === "published" ? new Date().toISOString() : undefined,
      errorMessage: status === "failed" ? "Zernio post failed" : undefined,
    };
  }

  async getPostMetrics(externalPostId: string): Promise<PostMetrics | null> {
    const result = await this.sdk().analytics.getAnalytics({
      query: { postId: externalPostId },
    });
    fail(result, "Zernio analytics failed");

    const data = result.data;
    if (!data) return null;
    if (data.syncStatus === "pending" || data.syncStatus === "unavailable") {
      return null;
    }

    const analytics =
      data.analytics ||
      data.platformAnalytics?.find((item) => item.platform === "tiktok")?.analytics ||
      null;
    if (!analytics) return null;

    const platform = data.platformAnalytics?.find((item) => item.platform === "tiktok");
    const postUrl = data.platformPostUrl || platform?.platformPostUrl || null;

    const metrics = {
      views: Number(analytics.views || 0),
      likes: Number(analytics.likes || 0),
      comments: Number(analytics.comments || 0),
      shares: Number(analytics.shares || 0),
    };

    // A zeroed payload without a sync timestamp means Zernio has not collected
    // this post yet; return null so the daily job never overwrites good data.
    if (
      !analytics.lastUpdated &&
      metrics.views === 0 &&
      metrics.likes === 0 &&
      metrics.comments === 0 &&
      metrics.shares === 0
    ) {
      return null;
    }

    return {
      externalPostId,
      ...metrics,
      collectedAt: analytics.lastUpdated || new Date().toISOString(),
      postUrl,
    };
  }
}
