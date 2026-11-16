import {
  SocialPublisherProvider,
  SocialAccount,
  PublishPostRequest,
  PublishPostResponse,
  PostMetrics,
} from "../types.js";
import { AppError } from "../../../shared/errors.js";

/**
 * PostForMePublisherAdapter (Phase 2 Stub)
 *
 * Implements SocialPublisherProvider as a placeholder for Post for Me integration.
 * In Phase 2, this will interact with the Post for Me API and handle webhooks.
 */
export class PostForMePublisherAdapter implements SocialPublisherProvider {
  readonly providerName = "postforme" as const;

  async listConnectedAccounts(): Promise<SocialAccount[]> {
    return [];
  }

  async publishPost(_request: PublishPostRequest): Promise<PublishPostResponse> {
    throw new AppError(
      "Post for Me provider is a Phase 2 stub and is not yet implemented for publishing",
      501,
      "not_implemented"
    );
  }

  async getPostStatus(_externalPostId: string): Promise<PublishPostResponse> {
    throw new AppError(
      "Post for Me provider is a Phase 2 stub and is not yet implemented for status checks",
      501,
      "not_implemented"
    );
  }

  async getPostMetrics(_externalPostId: string): Promise<PostMetrics | null> {
    throw new AppError(
      "Post for Me provider is a Phase 2 stub and is not yet implemented for metrics",
      501,
      "not_implemented"
    );
  }
}
