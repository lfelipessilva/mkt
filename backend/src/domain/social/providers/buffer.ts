import {
  SocialPublisherProvider,
  SocialAccount,
  PublishPostRequest,
  PublishPostResponse,
  PostMetrics,
} from "../types.js";

export class BufferPublisherAdapter implements SocialPublisherProvider {
  readonly providerName = "buffer" as const;

  async listConnectedAccounts(): Promise<SocialAccount[]> {
    throw new Error("Method not implemented.");
  }

  async publishPost(_request: PublishPostRequest): Promise<PublishPostResponse> {
    throw new Error("Method not implemented.");
  }

  async getPostStatus(_externalPostId: string): Promise<PublishPostResponse> {
    throw new Error("Method not implemented.");
  }

  async getPostMetrics(_externalPostId: string): Promise<PostMetrics | null> {
    throw new Error("Method not implemented.");
  }
}
