import { AppError } from "../../shared/errors.js";
import { SocialPublisherProvider } from "./types.js";
import { ZernioPublisherAdapter } from "./providers/zernio.js";
import { PostForMePublisherAdapter } from "./providers/postforme.js";

export type SocialPublisherFactory = (
  name?: string,
  options?: { apiKey?: string }
) => SocialPublisherProvider;

let customPublisherFactory: SocialPublisherFactory | null = null;

export function setSocialPublisherFactory(factory: SocialPublisherFactory | null): void {
  customPublisherFactory = factory;
}

export function getSocialPublisherProvider(
  name?: string,
  options?: { apiKey?: string }
): SocialPublisherProvider {
  if (customPublisherFactory) {
    return customPublisherFactory(name, options);
  }

  const providerName = name || "zernio";

  switch (providerName) {
    case "zernio":
      return new ZernioPublisherAdapter(undefined, options?.apiKey);
    case "postforme":
      return new PostForMePublisherAdapter();
    default:
      throw new AppError(`Unsupported social publisher provider: ${providerName}`, 400, "unsupported_provider");
  }
}
