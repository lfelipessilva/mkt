import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../../src/shared/db/migrate.js";
import { closePool } from "../../src/shared/db/client.js";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { setCustomSocialProvider } from "../../src/domain/social/routes.js";
import { getSocialPublisherProvider } from "../../src/domain/social/factory.js";
import type {
  SocialPublisherProvider,
  SocialAccount,
  PublishPostRequest,
  PublishPostResponse,
  PostMetrics,
} from "../../src/domain/social/types.js";

const { Pool } = pg;

class MockSocialProvider implements SocialPublisherProvider {
  readonly providerName = "zernio" as const;
  mockAccounts: SocialAccount[] = [];

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

describe("Task 7: Social Accounts Sync Endpoint & Post for Me Phase 2 Stubs", { timeout: 60000 }, () => {
  let container: StartedPostgreSqlContainer | null = null;
  let pool: pg.Pool;
  let app: FastifyInstance;
  let mockProvider: MockSocialProvider;

  const testToken = "test-secret-token-social-routes";
  const authHeaders = { authorization: `Bearer ${testToken}` };

  before(async () => {
    process.env.API_TOKEN = testToken;
    let connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      connectionString = container.getConnectionUri();
      process.env.DATABASE_URL = connectionString;
    }

    pool = new Pool({ connectionString });
    await runMigrations(pool);
    app = await buildApp();
  });

  beforeEach(async () => {
    setCustomSocialProvider(null);
    mockProvider = new MockSocialProvider();
    setCustomSocialProvider(mockProvider);

    await pool.query("TRUNCATE TABLE accounts CASCADE;");

    // Seed local accounts
    await pool.query(
      `INSERT INTO accounts (id, persona, role, enabled)
       VALUES 
         ('gabriel_tech', 'Gabriel entusiasta tech e dev', 'single_man', true),
         ('rebeca_fitness', 'Rebeca atleta fitness', 'single_woman', true),
         ('lucas_games', 'Lucas gamer streamer', 'single_man', true)`
    );
  });

  after(async () => {
    setCustomSocialProvider(null);
    if (app) {
      await app.close();
    }
    await closePool();
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  it("POST /api/v1/social/accounts/sync pulls channels from Buffer and associates external_account_id to accounts", async () => {
    mockProvider.mockAccounts = [
      {
        internalAccountId: "buf_chan_1",
        provider: "zernio",
        externalAccountId: "buf_chan_1",
        username: "@gabriel_tech",
        service: "tiktok",
        isActive: true,
      },
      {
        internalAccountId: "buf_chan_2",
        provider: "zernio",
        externalAccountId: "buf_chan_2",
        username: "rebeca_fitness",
        service: "tiktok",
        isActive: true,
      },
      {
        internalAccountId: "buf_chan_unmatched",
        provider: "zernio",
        externalAccountId: "buf_chan_unmatched",
        username: "unrelated_channel",
        service: "tiktok",
        isActive: true,
      },
    ];

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/social/accounts/sync",
      headers: authHeaders,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.synced, 3);
    assert.equal(body.matched, 2);
    assert.equal(body.accounts.length, 3);

    // Verify DB was updated
    const gabrielDb = await pool.query("SELECT * FROM accounts WHERE id = 'gabriel_tech'");
    assert.equal(gabrielDb.rows[0].external_account_id, "buf_chan_1");
    assert.equal(gabrielDb.rows[0].social_provider, "zernio");

    const rebecaDb = await pool.query("SELECT * FROM accounts WHERE id = 'rebeca_fitness'");
    assert.equal(rebecaDb.rows[0].external_account_id, "buf_chan_2");
    assert.equal(rebecaDb.rows[0].social_provider, "zernio");

    const lucasDb = await pool.query("SELECT * FROM accounts WHERE id = 'lucas_games'");
    assert.equal(lucasDb.rows[0].external_account_id, null);
  });

  it("POST /api/v1/social/accounts/sync requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/social/accounts/sync",
    });
    assert.equal(res.statusCode, 401);
  });

  it("POST /api/v1/webhooks/social/postforme acknowledges webhook events without requiring auth", async () => {
    const eventPayload = {
      event: "post.published",
      post_id: "post_12345",
      status: "published",
      timestamp: "2026-11-15T22:00:00Z",
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/social/postforme",
      payload: eventPayload,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.acknowledged, true);
  });

  it("factory instantiates postforme provider as PostForMePublisherAdapter", () => {
    const provider = getSocialPublisherProvider("postforme");
    assert.equal(provider.providerName, "postforme");
    assert.rejects(
      async () => provider.publishPost({} as any),
      /Phase 2/
    );
  });
});
