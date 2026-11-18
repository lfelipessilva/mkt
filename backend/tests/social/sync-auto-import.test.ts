import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { syncSocialAccounts } from "../../src/domain/social/routes.js";
import { setSocialPublisherFactory } from "../../src/domain/social/factory.js";
import type {
  SocialPublisherProvider,
  SocialAccount,
  PublishPostRequest,
  PublishPostResponse,
  PostMetrics,
} from "../../src/domain/social/types.js";

class MockSocialProvider implements SocialPublisherProvider {
  readonly providerName = "zernio" as const;
  constructor(public mockAccounts: SocialAccount[]) {}

  async listConnectedAccounts(): Promise<SocialAccount[]> {
    return this.mockAccounts;
  }

  async publishPost(_request: PublishPostRequest): Promise<PublishPostResponse> {
    throw new Error("Not implemented in mock");
  }

  async getPostStatus(_externalPostId: string): Promise<PublishPostResponse> {
    throw new Error("Not implemented in mock");
  }

  async getPostMetrics(_externalPostId: string): Promise<PostMetrics | null> {
    throw new Error("Not implemented in mock");
  }
}

describe("Task 2: syncSocialAccounts Auto-Import", () => {
  it("links existing accounts and auto-imports unmatched channels", async () => {
    // In-memory mock database for accounts
    const accountsDb: Array<{
      id: string;
      display_name: string | null;
      persona: string;
      role: string;
      enabled: boolean;
      tiktok_open_id: string | null;
      social_provider: string | null;
      external_account_id: string | null;
      social_account_metadata: any;
      created_at: Date;
      updated_at: Date;
    }> = [
      {
        id: "gabriel_tech",
        display_name: "Gabriel Tech",
        persona: "Gabriel entusiasta tech e dev",
        role: "single_man",
        enabled: true,
        tiktok_open_id: null,
        social_provider: null,
        external_account_id: null,
        social_account_metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const mockPool = {
      async query(sql: string, params: any[] = []) {
        const normalized = sql.trim();
        // 1. SELECT query in listAccounts: SELECT id, display_name, persona, role, enabled... FROM accounts ORDER BY created_at ASC, id ASC
        if (normalized.startsWith("SELECT") && normalized.includes("FROM accounts")) {
          if (normalized.includes("WHERE id = $1")) {
            const acc = accountsDb.find((a) => a.id === params[0]);
            return { rows: acc ? [acc] : [], rowCount: acc ? 1 : 0 };
          }
          return { rows: [...accountsDb], rowCount: accountsDb.length };
        }

        // 2. UPDATE query for matched accounts in syncSocialAccounts
        if (normalized.startsWith("UPDATE accounts")) {
          const externalAccountId = params[0];
          const socialProvider = params[1];
          const channelUsername = JSON.parse(params[2]);
          const accountId = params[3];

          const acc = accountsDb.find((a) => a.id === accountId);
          if (acc) {
            acc.external_account_id = externalAccountId;
            acc.social_provider = socialProvider;
            acc.social_account_metadata = {
              ...(acc.social_account_metadata || {}),
              channel_username: channelUsername,
            };
            acc.updated_at = new Date();
          }
          return { rows: [], rowCount: acc ? 1 : 0 };
        }

        // 3. INSERT ... ON CONFLICT in upsertAccount
        if (normalized.startsWith("INSERT INTO accounts")) {
          const [
            id,
            displayName,
            persona,
            role,
            enabled,
            _autoPostEnabled,
            tiktokOpenId,
            socialProvider,
            externalAccountId,
            socialAccountMetadataStr,
          ] = params;

          const existingIndex = accountsDb.findIndex((a) => a.id === id);
          const meta = JSON.parse(socialAccountMetadataStr || "{}");
          const record = {
            id,
            display_name: displayName,
            persona,
            role,
            enabled,
            tiktok_open_id: tiktokOpenId,
            social_provider: socialProvider,
            external_account_id: externalAccountId,
            social_account_metadata: meta,
            created_at: existingIndex >= 0 ? accountsDb[existingIndex].created_at : new Date(),
            updated_at: new Date(),
          };

          if (existingIndex >= 0) {
            accountsDb[existingIndex] = record;
          } else {
            accountsDb.push(record);
          }

          return { rows: [record], rowCount: 1 };
        }

        throw new Error(`Unhandled mock query: ${sql}`);
      },
    } as unknown as Pool;

    const mockProvider = new MockSocialProvider([
      {
        externalAccountId: "buf_chan_gabriel",
        name: "Gabriel Tech",
        username: "gabriel_tech",
        provider: "zernio",
      },
      {
        externalAccountId: "buf_chan_tiktok_novo",
        name: "Novo Canal TikTok",
        username: "@novo_canal_tiktok",
        provider: "zernio",
      },
    ]);

    const result = await syncSocialAccounts(mockPool, mockProvider);

    // Assert return summary
    assert.equal(result.synced, 2);
    assert.equal(result.matched, 1);
    assert.equal((result as any).created, 1);

    // Assert existing account gabriel_tech was linked and persona preserved
    const gabriel = accountsDb.find((a) => a.id === "gabriel_tech");
    assert.ok(gabriel);
    assert.equal(gabriel.external_account_id, "buf_chan_gabriel");
    assert.equal(gabriel.social_provider, "zernio");
    assert.equal(gabriel.persona, "Gabriel entusiasta tech e dev");

    // Assert auto-created account
    const novoCanal = accountsDb.find((a) => a.id === "novo_canal_tiktok");
    assert.ok(novoCanal);
    assert.equal(novoCanal.social_provider, "zernio");
    assert.equal(novoCanal.external_account_id, "buf_chan_tiktok_novo");
    assert.equal(novoCanal.enabled, true);
  });

  afterEach(() => {
    setSocialPublisherFactory(null);
  });

  it("pulls channels from every configured Zernio API key", async () => {
    const accountsDb: Array<Record<string, any>> = [
      {
        id: "acc_a",
        display_name: "Conta A",
        persona: "Conta A",
        role: "single_woman",
        enabled: true,
        tiktok_open_id: null,
        social_provider: "zernio",
        external_account_id: null,
        social_account_metadata: {},
        zernio_api_key: "key-aaa",
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: "acc_b",
        display_name: "Conta B",
        persona: "Conta B",
        role: "single_man",
        enabled: true,
        tiktok_open_id: null,
        social_provider: "zernio",
        external_account_id: null,
        social_account_metadata: {},
        zernio_api_key: "key-bbb",
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: "acc_c",
        display_name: "Conta C",
        persona: "Conta C",
        role: "single_woman",
        enabled: true,
        tiktok_open_id: null,
        social_provider: "zernio",
        external_account_id: null,
        social_account_metadata: {},
        zernio_api_key: "key-ccc",
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const mockPool = {
      async query(sql: string, params: any[] = []) {
        const normalized = sql.trim();
        if (normalized.startsWith("SELECT") && normalized.includes("FROM accounts")) {
          if (normalized.includes("WHERE id = $1")) {
            const acc = accountsDb.find((a) => a.id === params[0]);
            return { rows: acc ? [acc] : [], rowCount: acc ? 1 : 0 };
          }
          return { rows: [...accountsDb], rowCount: accountsDb.length };
        }
        if (normalized.startsWith("UPDATE accounts")) {
          const acc = accountsDb.find((a) => a.id === params[3]);
          if (acc) {
            acc.external_account_id = params[0];
            acc.social_provider = params[1];
            acc.zernio_api_key = acc.zernio_api_key ?? params[4];
          }
          return { rows: [], rowCount: acc ? 1 : 0 };
        }
        if (normalized.startsWith("INSERT INTO accounts")) {
          return { rows: [{}], rowCount: 1 };
        }
        throw new Error(`Unhandled mock query: ${sql}`);
      },
    } as unknown as Pool;

    const queriedKeys: string[] = [];
    setSocialPublisherFactory((_name, options) => {
      const key = options?.apiKey || "";
      queriedKeys.push(key);
      if (key === "key-aaa") {
        return new MockSocialProvider([
          {
            externalAccountId: "chan_a",
            username: "acc_a",
            provider: "zernio",
          },
        ]);
      }
      if (key === "key-bbb") {
        return new MockSocialProvider([
          {
            externalAccountId: "chan_b",
            username: "acc_b",
            provider: "zernio",
          },
        ]);
      }
      throw new Error("invalid key");
    });

    const previousEnvKey = process.env.ZERNIO_API_KEY;
    delete process.env.ZERNIO_API_KEY;

    try {
      const result = await syncSocialAccounts(mockPool);

      assert.deepEqual(queriedKeys.sort(), ["key-aaa", "key-bbb", "key-ccc"]);
      assert.equal(result.synced, 2);
      assert.equal(result.matched, 2);
      assert.deepEqual(
        accountsDb.map((a) => a.external_account_id).filter(Boolean).sort(),
        ["chan_a", "chan_b"]
      );
      assert.equal(result.errors?.length, 1);
      assert.match(result.errors?.[0] || "", /invalid key/);
    } finally {
      if (previousEnvKey !== undefined) {
        process.env.ZERNIO_API_KEY = previousEnvKey;
      } else {
        delete process.env.ZERNIO_API_KEY;
      }
    }
  });
});
