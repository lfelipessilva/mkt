import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { getSocialPublisherProvider } from "./factory.js";
import { listAccounts } from "../accounts/store.js";
import type { SocialPublisherProvider, SocialAccount } from "./types.js";

let customProvider: SocialPublisherProvider | null = null;

export function setCustomSocialProvider(provider: SocialPublisherProvider | null): void {
  customProvider = provider;
}

export interface SyncAccountsResult {
  synced: number;
  matched: number;
  accounts: Array<{
    id: string;
    persona: string;
    external_account_id: string | null;
    social_provider: string | null;
    username?: string;
  }>;
}

/**
 * Sync accounts from social publisher provider (e.g. Buffer).
 * Matches connected channels to local accounts by handle/persona or id.
 */
export async function syncSocialAccounts(
  poolInstance?: Pool,
  providerInstance?: SocialPublisherProvider
): Promise<SyncAccountsResult> {
  const p = poolInstance || getPool();
  const provider = providerInstance || customProvider || getSocialPublisherProvider();

  const channels: SocialAccount[] = await provider.listConnectedAccounts();
  const existingAccounts = await listAccounts(p);

  const matchedAccounts: Array<{
    id: string;
    persona: string;
    external_account_id: string | null;
    social_provider: string | null;
    username?: string;
  }> = [];

  let matchedCount = 0;

  for (const acc of existingAccounts) {
    // Attempt match by username, persona, or id (case-insensitive substring or equality)
    const matchedChannel = channels.find((ch) => {
      const cleanUsername = (ch.username || "").replace(/^@/, "").toLowerCase().trim();
      const cleanId = acc.id.toLowerCase().trim();
      const cleanPersona = (acc.persona || "").toLowerCase().trim();
      const cleanDisplay = (acc.display_name || "").toLowerCase().trim();

      if (!cleanUsername) return false;

      return (
        cleanId === cleanUsername ||
        cleanPersona.includes(cleanUsername) ||
        cleanUsername.includes(cleanId) ||
        (cleanDisplay && cleanDisplay.includes(cleanUsername))
      );
    });

    if (matchedChannel) {
      await p.query(
        `UPDATE accounts
         SET external_account_id = $1,
             social_provider = $2,
             social_account_metadata = jsonb_set(
               COALESCE(social_account_metadata, '{}'::jsonb),
               '{channel_username}',
               $3::jsonb
             ),
             updated_at = NOW()
         WHERE id = $4`,
        [
          matchedChannel.externalAccountId,
          matchedChannel.provider,
          JSON.stringify(matchedChannel.username),
          acc.id,
        ]
      );

      matchedAccounts.push({
        id: acc.id,
        persona: acc.persona,
        external_account_id: matchedChannel.externalAccountId,
        social_provider: matchedChannel.provider,
        username: matchedChannel.username,
      });
      matchedCount++;
    } else {
      matchedAccounts.push({
        id: acc.id,
        persona: acc.persona,
        external_account_id: acc.external_account_id ?? null,
        social_provider: acc.social_provider ?? null,
      });
    }
  }

  return {
    synced: channels.length,
    matched: matchedCount,
    accounts: matchedAccounts,
  };
}

export const socialRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/v1/social/accounts/sync
  app.post("/accounts/sync", async (_request, reply) => {
    const result = await syncSocialAccounts();
    return reply.send(result);
  });
};

export const socialWebhookRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/v1/webhooks/social/postforme
  app.post("/social/postforme", async (request, reply) => {
    app.log.info({ body: request.body }, "Post for Me webhook received (Phase 2 stub)");
    return reply.send({ ok: true, acknowledged: true });
  });
};
