import { AppError } from "../../shared/errors.js";
import { SocialPublisherProvider } from "./types.js";
import { ZernioPublisherAdapter } from "./providers/zernio.js";
import { PostForMePublisherAdapter } from "./providers/postforme.js";

export function getSocialPublisherProvider(name?: string): SocialPublisherProvider {
  const providerName = name || "zernio";

  switch (providerName) {
    case "zernio":
      return new ZernioPublisherAdapter();
    case "postforme":
      return new PostForMePublisherAdapter();
    default:
      throw new AppError(`Unsupported social publisher provider: ${providerName}`, 400, "unsupported_provider");
  }
}
