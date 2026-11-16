import { AppError } from "../../../shared/errors.js";
import {
  SocialPublisherProvider,
  SocialAccount,
  PublishPostRequest,
  PublishPostResponse,
  PostMetrics,
  PublishStatus,
} from "../types.js";

export interface BufferAdapterOptions {
  apiUrl?: string;
  accessToken?: string;
  maxRetries?: number;
  baseDelayMs?: number;
}

export class BufferPublisherAdapter implements SocialPublisherProvider {
  readonly providerName = "buffer" as const;

  private readonly apiUrl: string;
  private readonly accessToken: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(options: BufferAdapterOptions = {}) {
    this.apiUrl = options.apiUrl || process.env.BUFFER_API_URL || "https://api.buffer.com";
    this.accessToken = options.accessToken || process.env.BUFFER_ACCESS_TOKEN || "";
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async requestGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let attempt = 0;

    while (true) {
      attempt++;
      let response: Response;
      try {
        response = await fetch(this.apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify({ query, variables }),
        });
      } catch (err: any) {
        if (attempt > this.maxRetries) {
          throw new AppError(`Buffer network error: ${err.message}`, 502, "buffer_network_error", {
            cause: err,
          });
        }
        await this.sleep(this.baseDelayMs * Math.pow(2, attempt - 1));
        continue;
      }

      if (response.status === 429) {
        if (attempt > this.maxRetries) {
          throw new AppError("Buffer rate limit exceeded (HTTP 429)", 429, "buffer_rate_limit_exceeded");
        }
        const retryAfterSec = Number(response.headers.get("Retry-After")) || 0;
        const delay = retryAfterSec > 0 ? retryAfterSec * 1000 : this.baseDelayMs * Math.pow(2, attempt - 1);
        await this.sleep(delay);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new AppError(
          `Buffer HTTP error status ${response.status}: ${text}`,
          response.status >= 500 ? 502 : 400,
          "buffer_http_error"
        );
      }

      const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

      if (json.errors && json.errors.length > 0) {
        throw new AppError(
          `Buffer GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`,
          400,
          "buffer_graphql_error"
        );
      }

      return json.data as T;
    }
  }

  async listConnectedAccounts(): Promise<SocialAccount[]> {
    const orgsQuery = `
      query GetOrganizations {
        account {
          organizations {
            id
            name
          }
        }
      }
    `;

    interface OrgsResponse {
      account?: {
        organizations?: Array<{
          id: string;
          name?: string;
        }>;
      };
    }

    const orgsData = await this.requestGraphQL<OrgsResponse>(orgsQuery);
    const orgs = orgsData.account?.organizations || [];

    const channelsQuery = `
      query GetChannels($input: ChannelsInput!) {
        channels(input: $input) {
          id
          name
          displayName
          service
        }
      }
    `;

    interface ChannelsResponse {
      channels?: Array<{
        id: string;
        name: string;
        displayName?: string | null;
        service: string;
      }>;
    }

    const accounts: SocialAccount[] = [];

    for (const org of orgs) {
      const channelsData = await this.requestGraphQL<ChannelsResponse>(channelsQuery, {
        input: { organizationId: org.id },
      });

      for (const channel of channelsData.channels || []) {
        if (channel.service === "tiktok") {
          accounts.push({
            internalAccountId: channel.id,
            provider: "buffer",
            externalAccountId: channel.id,
            username: channel.displayName || channel.name,
            service: "tiktok",
            isActive: true,
          });
        }
      }
    }

    if (accounts.length > 3) {
      throw new AppError(
        `Buffer Free tier permits a maximum of 3 active TikTok accounts. Found: ${accounts.length}`,
        400,
        "buffer_account_limit_exceeded"
      );
    }

    return accounts;
  }

  async publishPost(request: PublishPostRequest): Promise<PublishPostResponse> {
    const query = `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess {
            post {
              id
              status
              dueAt
            }
          }
          ... on MutationError {
            message
          }
        }
      }
    `;

    const input: Record<string, unknown> = {
      channelId: request.externalAccountId,
      text: request.caption,
      schedulingType: "automatic",
    };

    if (request.publishMode === "immediate") {
      input.mode = "shareNow";
    } else {
      input.mode = "customScheduled";
      input.dueAt = request.scheduledAt;
    }

    if (request.media.type === "carousel") {
      input.assets = request.media.imageUrls.map((url) => ({
        image: { url },
      }));
    } else if (request.media.type === "video") {
      input.assets = [
        {
          video: { url: request.media.videoUrl },
        },
      ];
      if (request.media.thumbnailOffsetMs !== undefined) {
        input.metadata = {
          tiktok: {
            thumbnailOffset: request.media.thumbnailOffsetMs,
          },
        };
      }
    }

    interface CreatePostResponse {
      createPost?: {
        post?: {
          id: string;
          status: string;
          dueAt?: string | null;
        };
        message?: string;
      };
    }

    const data = await this.requestGraphQL<CreatePostResponse>(query, { input });

    if (!data.createPost) {
      return {
        externalPostId: "",
        status: "failed",
        errorMessage: "Buffer returned empty createPost response",
        rawResponse: (data as any) || {},
      };
    }

    if (data.createPost.message) {
      return {
        externalPostId: "",
        status: "failed",
        errorMessage: data.createPost.message,
        rawResponse: data.createPost as unknown as Record<string, unknown>,
      };
    }

    const post = data.createPost.post;
    if (!post) {
      return {
        externalPostId: "",
        status: "failed",
        errorMessage: "Buffer post object missing in response",
        rawResponse: data.createPost as unknown as Record<string, unknown>,
      };
    }

    const status = this.mapBufferStatus(post.status);

    return {
      externalPostId: post.id,
      status,
      publishedAt: status === "published" ? new Date().toISOString() : undefined,
      rawResponse: post as unknown as Record<string, unknown>,
    };
  }

  async getPostStatus(externalPostId: string): Promise<PublishPostResponse> {
    const query = `
      query GetPost($id: ID!) {
        post(id: $id) {
          id
          status
          sentAt
          error {
            message
          }
        }
      }
    `;

    interface GetPostResponse {
      post?: {
        id: string;
        status: string;
        sentAt?: string | null;
        error?: {
          message: string;
        } | null;
      } | null;
    }

    const data = await this.requestGraphQL<GetPostResponse>(query, { id: externalPostId });

    if (!data.post) {
      return {
        externalPostId,
        status: "failed",
        errorMessage: `Post not found in Buffer: ${externalPostId}`,
        rawResponse: {},
      };
    }

    const status = this.mapBufferStatus(data.post.status);

    return {
      externalPostId: data.post.id,
      status,
      publishedAt: data.post.sentAt || undefined,
      errorMessage: data.post.error?.message,
      rawResponse: data.post as unknown as Record<string, unknown>,
    };
  }

  async getPostMetrics(externalPostId: string): Promise<PostMetrics | null> {
    const query = `
      query GetPostMetrics($id: ID!) {
        post(id: $id) {
          id
          sentAt
          metrics {
            type
            name
            value
            unit
          }
          metricsUpdatedAt
        }
      }
    `;

    interface GetMetricsResponse {
      post?: {
        id: string;
        sentAt?: string | null;
        metrics?: Array<{
          type?: string;
          name?: string;
          value?: number | string;
          unit?: string;
        }>;
        metricsUpdatedAt?: string | null;
      } | null;
    }

    const data = await this.requestGraphQL<GetMetricsResponse>(query, { id: externalPostId });

    if (!data.post) {
      return null;
    }

    // Guardrail: 30-day window check
    if (data.post.sentAt) {
      const sentTime = new Date(data.post.sentAt).getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - sentTime > thirtyDaysMs) {
        return null;
      }
    }

    let views = 0;
    let likes = 0;
    let comments = 0;
    let shares = 0;

    for (const m of data.post.metrics || []) {
      const val = Number(m.value) || 0;
      const type = (m.type || m.name || "").toLowerCase();

      if (type.includes("impression") || type.includes("view")) {
        views += val;
      } else if (type.includes("reaction") || type.includes("like")) {
        likes += val;
      } else if (type.includes("comment")) {
        comments += val;
      } else if (type.includes("share") || type.includes("repost")) {
        shares += val;
      }
    }

    return {
      externalPostId,
      views,
      likes,
      comments,
      shares,
      collectedAt: data.post.metricsUpdatedAt || new Date().toISOString(),
    };
  }

  private mapBufferStatus(bufferStatus: string): PublishStatus {
    const lower = (bufferStatus || "").toLowerCase();
    switch (lower) {
      case "sent":
      case "published":
        return "published";
      case "failed":
      case "error":
        return "failed";
      case "processing":
      case "sending":
        return "processing";
      case "queued":
      case "buffer":
      case "scheduled":
      default:
        return "queued";
    }
  }
}
