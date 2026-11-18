import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";
import { getPool } from "../../shared/db/client.js";
import { getSocialPublisherProvider } from "./factory.js";
import { ZernioPublisherAdapter } from "./providers/zernio.js";
import { listAccounts, upsertAccount } from "../accounts/store.js";
import type { SocialPublisherProvider, SocialAccount } from "./types.js";

let customProvider: SocialPublisherProvider | null = null;

export function setCustomSocialProvider(provider: SocialPublisherProvider | null): void {
  customProvider = provider;
}

export interface SyncAccountsResult {
  synced: number;
  matched: number;
  created: number;
  accounts: Array<{
    id: string;
    persona: string;
    external_account_id: string | null;
    social_provider: string | null;
    username?: string;
  }>;
  errors?: string[];
}

function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return `****${key.slice(-4)}`;
}

/**
 * Collects channels from every configured Zernio API key. Each account may
 * carry its own `zernio_api_key`, so pulling account information must query all
 * of them (plus the global `ZERNIO_API_KEY` fallback), not just one.
 */
async function listAllProvisionedChannels(
  existingAccounts: Array<{ zernio_api_key?: string | null }>
): Promise<{
  channels: SocialAccount[];
  keyByExternalId: Map<string, string>;
  errors: string[];
}> {
  const channelMap = new Map<string, SocialAccount>();
  const keyByExternalId = new Map<string, string>();
  const errors: string[] = [];

  const collect = async (provider: SocialPublisherProvider, persistKey?: string) => {
    const list = await provider.listConnectedAccounts();
    for (const channel of list) {
      if (!channel.externalAccountId || channelMap.has(channel.externalAccountId)) continue;
      channelMap.set(channel.externalAccountId, channel);
      if (persistKey) keyByExternalId.set(channel.externalAccountId, persistKey);
    }
  };

  const accountKeys = new Set<string>();
  for (const acc of existingAccounts) {
    const key = acc.zernio_api_key?.trim();
    if (key) accountKeys.add(key);
  }
  const envKey = process.env.ZERNIO_API_KEY?.trim();

  const keysToQuery = new Set<string>(accountKeys);
  if (envKey) keysToQuery.add(envKey);

  if (keysToQuery.size === 0) {
    // No per-account key and no global key: let the default provider report
    // the missing configuration as before.
    await collect(getSocialPublisherProvider());
    return { channels: [...channelMap.values()], keyByExternalId, errors };
  }

  for (const key of keysToQuery) {
    try {
      await collect(
        getSocialPublisherProvider("zernio", { apiKey: key }),
        accountKeys.has(key) ? key : undefined
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Chave ${maskKey(key)}: ${message}`);
    }
  }

  return { channels: [...channelMap.values()], keyByExternalId, errors };
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
  const existingAccounts = await listAccounts(p);

  let channels: SocialAccount[];
  let keyByExternalId = new Map<string, string>();
  let syncErrors: string[] = [];

  if (providerInstance) {
    channels = await providerInstance.listConnectedAccounts();
  } else if (customProvider) {
    channels = await customProvider.listConnectedAccounts();
  } else {
    const collected = await listAllProvisionedChannels(existingAccounts);
    channels = collected.channels;
    keyByExternalId = collected.keyByExternalId;
    syncErrors = collected.errors;
  }

  const matchedAccounts: Array<{
    id: string;
    persona: string;
    external_account_id: string | null;
    social_provider: string | null;
    username?: string;
  }> = [];

  let matchedCount = 0;
  let createdCount = 0;
  const matchedChannelIds = new Set<string>();

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
      matchedChannelIds.add(matchedChannel.externalAccountId);
      const channelKey = keyByExternalId.get(matchedChannel.externalAccountId);
      await p.query(
        `UPDATE accounts
         SET external_account_id = $1,
             social_provider = $2,
             social_account_metadata = jsonb_set(
               COALESCE(social_account_metadata, '{}'::jsonb),
               '{channel_username}',
               $3::jsonb
             ),
             zernio_api_key = COALESCE(zernio_api_key, $5),
             updated_at = NOW()
         WHERE id = $4`,
        [
          matchedChannel.externalAccountId,
          matchedChannel.provider,
          JSON.stringify(matchedChannel.username),
          acc.id,
          channelKey ?? null,
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

  // Auto-import channels not matched with any existing account
  for (const ch of channels) {
    if (!matchedChannelIds.has(ch.externalAccountId)) {
      const channelName = (ch as { name?: string }).name || ch.username;
      const cleanId = (ch.username || channelName)
        .replace(/^@/, "")
        .replace(/[^a-zA-Z0-9_.-]/g, "_")
        .toLowerCase()
        .trim();

      const channelKey = keyByExternalId.get(ch.externalAccountId);

      await upsertAccount(
        {
          id: cleanId,
          display_name: channelName || cleanId,
          role: "single_woman",
          persona: `Conta importada via Zernio (${ch.username || channelName})`,
          enabled: true,
          social_provider: ch.provider,
          external_account_id: ch.externalAccountId,
          social_account_metadata: {
            channel_username: ch.username,
          },
          zernio_api_key: channelKey ?? null,
        },
        p
      );

      matchedAccounts.push({
        id: cleanId,
        persona: `Conta importada via Zernio (${ch.username || channelName})`,
        external_account_id: ch.externalAccountId,
        social_provider: ch.provider,
        username: ch.username,
      });
      createdCount++;
    }
  }

  return {
    synced: channels.length,
    matched: matchedCount,
    created: createdCount,
    accounts: matchedAccounts,
    ...(syncErrors.length > 0 ? { errors: syncErrors } : {}),
  };
}

export const socialRoutes: FastifyPluginAsync = async (app) => {
  app.post("/accounts/sync", async (_request, reply) => {
    const result = await syncSocialAccounts();
    return reply.send(result);
  });

  app.get("/connect/tiktok", async (_request, reply) => {
    const provider = customProvider || getSocialPublisherProvider();
    if (!(provider instanceof ZernioPublisherAdapter)) {
      return reply.code(400).send({ error: "connect is only available for zernio" });
    }
    const authUrl = await provider.getTikTokConnectUrl();
    return reply.send({ authUrl });
  });
};

export const socialWebhookRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/v1/webhooks/social/postforme
  app.post("/social/postforme", async (request, reply) => {
    app.log.info({ body: request.body }, "Post for Me webhook received (Phase 2 stub)");
    return reply.send({ ok: true, acknowledged: true });
  });
};
