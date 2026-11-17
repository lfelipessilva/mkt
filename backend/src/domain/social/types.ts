export type SocialProviderType = "zernio" | "postforme";

export interface SocialAccount {
  internalAccountId: string; // ID da conta no app (ex: 'gabriel', 'lucas')
  provider: SocialProviderType;
  externalAccountId: string;
  username: string; // @perfil no TikTok
  service: "tiktok";
  isActive: boolean;
}

export type SocialMediaType = "carousel" | "video";

export interface SocialMediaCarousel {
  type: "carousel";
  imageUrls: string[]; // URLs públicas HTTPS dos slides (mínimo 2, máx 35)
}

export interface SocialMediaVideo {
  type: "video";
  videoUrl: string; // URL pública HTTPS do vídeo .mp4/.mov
  thumbnailOffsetMs?: number;
}

export type SocialMediaContent = SocialMediaCarousel | SocialMediaVideo;

export interface PublishPostRequest {
  internalPostId: string; // UUID do run/post interno
  externalAccountId: string; // ID da conta no provedor
  caption: string;
  media: SocialMediaContent;
  publishMode: "immediate" | "scheduled";
  scheduledAt?: string; // ISO-8601 (obrigatório se scheduled)
  schedulingType?: "automatic" | "notification";
}

export type PublishStatus = "queued" | "processing" | "published" | "failed";

export interface PublishPostResponse {
  externalPostId: string;
  status: PublishStatus;
  rawResponse: Record<string, unknown>;
  publishedAt?: string;
  errorMessage?: string;
}

export interface PostMetrics {
  externalPostId: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  collectedAt: string; // ISO-8601
  postUrl?: string | null;
}

export interface SocialPublisherProvider {
  readonly providerName: SocialProviderType;

  listConnectedAccounts(): Promise<SocialAccount[]>;
  publishPost(request: PublishPostRequest): Promise<PublishPostResponse>;
  getPostStatus(externalPostId: string): Promise<PublishPostResponse>;
  getPostMetrics(externalPostId: string): Promise<PostMetrics | null>;
}
