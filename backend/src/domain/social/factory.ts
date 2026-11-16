import { AppError } from "../../shared/errors.js";
import { SocialPublisherProvider } from "./types.js";
import { BufferPublisherAdapter } from "./providers/buffer.js";

export function getSocialPublisherProvider(name?: string): SocialPublisherProvider {
  const providerName = name || process.env.SOCIAL_PROVIDER || "buffer";

  switch (providerName) {
    case "buffer":
      return new BufferPublisherAdapter();
    default:
      throw new AppError(`Unsupported social publisher provider: ${providerName}`, 400, "unsupported_provider");
  }
}
