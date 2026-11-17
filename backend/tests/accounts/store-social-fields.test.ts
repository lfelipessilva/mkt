import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { upsertAccount, getAccount } from "../../src/domain/accounts/store.js";
import { CreateAccountSchema, UpdateAccountSchema } from "../../src/domain/accounts/schemas.js";

describe("accounts store - social fields persistence", () => {
  it("upsertAccount saves external_account_id, social_provider, and social_account_metadata", async () => {
    const executedQueries: { text: string; values?: unknown[] }[] = [];

    // Mock Pool where getAccount returns null (insert scenario)
    // and query returns the inserted row with social fields
    const mockPool = {
      async query(textOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]) {
        const queryText = typeof textOrConfig === "string" ? textOrConfig : textOrConfig.text;
        const queryValues = typeof textOrConfig === "string" ? values : textOrConfig.values;
        executedQueries.push({ text: queryText, values: queryValues });

        // If SELECT query from getAccount
        if (queryText.includes("SELECT")) {
          return { rows: [] };
        }

        // If INSERT query
        if (queryText.includes("INSERT INTO accounts")) {
          const rawMetadata = queryValues?.[9];
          const metadata = typeof rawMetadata === "string" ? JSON.parse(rawMetadata) : rawMetadata;
          return {
            rows: [
              {
                id: queryValues?.[0],
                display_name: queryValues?.[1],
                persona: queryValues?.[2],
                role: queryValues?.[3],
                enabled: queryValues?.[4],
                auto_post_enabled: queryValues?.[5],
                tiktok_open_id: queryValues?.[6],
                social_provider: queryValues?.[7],
                external_account_id: queryValues?.[8],
                social_account_metadata: metadata,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        }

        return { rows: [] };
      },
    } as unknown as Pool;

    const input = {
      id: "acc_test_social",
      display_name: "Test Account",
      persona: "Persona description",
      role: "single_woman" as const,
      enabled: true,
      social_provider: "buffer",
      external_account_id: "ext_buf_123",
      social_account_metadata: { channel_name: "test_channel" },
    };

    const result = await upsertAccount(input, mockPool);

    assert.equal(result.id, "acc_test_social");
    assert.equal(result.social_provider, "buffer");
    assert.equal(result.external_account_id, "ext_buf_123");
    assert.deepEqual(result.social_account_metadata, { channel_name: "test_channel" });

    // Verify query text included social fields
    const insertQuery = executedQueries.find((q) => q.text.includes("INSERT INTO accounts"));
    assert.ok(insertQuery, "Expected INSERT INTO accounts query to be executed");
    assert.match(insertQuery.text, /social_provider/);
    assert.match(insertQuery.text, /external_account_id/);
    assert.match(insertQuery.text, /social_account_metadata/);
  });

  it("upsertAccount updates existing account social fields", async () => {
    const executedQueries: { text: string; values?: unknown[] }[] = [];

    const existingAccount = {
      id: "acc_existing",
      display_name: "Existing Acc",
      persona: "Existing Persona",
      role: "single_woman",
      enabled: true,
      tiktok_open_id: null,
      social_provider: null,
      external_account_id: null,
      social_account_metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockPool = {
      async query(textOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]) {
        const queryText = typeof textOrConfig === "string" ? textOrConfig : textOrConfig.text;
        const queryValues = typeof textOrConfig === "string" ? values : textOrConfig.values;
        executedQueries.push({ text: queryText, values: queryValues });

        if (queryText.includes("SELECT")) {
          return { rows: [existingAccount] };
        }

        if (queryText.includes("INSERT INTO accounts")) {
          const rawMetadata = queryValues?.[9];
          const metadata =
            typeof rawMetadata === "string" ? JSON.parse(rawMetadata) : rawMetadata;
          return {
            rows: [
              {
                id: queryValues?.[0],
                display_name: queryValues?.[1],
                persona: queryValues?.[2],
                role: queryValues?.[3],
                enabled: queryValues?.[4],
                auto_post_enabled: queryValues?.[5],
                tiktok_open_id: queryValues?.[6],
                social_provider: queryValues?.[7],
                external_account_id: queryValues?.[8],
                social_account_metadata: metadata,
                created_at: existingAccount.created_at,
                updated_at: new Date(),
              },
            ],
          };
        }

        return { rows: [] };
      },
    } as unknown as Pool;

    const input = {
      id: "acc_existing",
      social_provider: "buffer",
      external_account_id: "ext_new_999",
    };

    const result = await upsertAccount(input, mockPool);

    assert.equal(result.id, "acc_existing");
    assert.equal(result.display_name, "Existing Acc");
    assert.equal(result.persona, "Existing Persona");
    assert.equal(result.social_provider, "buffer");
    assert.equal(result.external_account_id, "ext_new_999");
  });

  it("CreateAccountSchema and UpdateAccountSchema accept social fields", () => {
    const createData = {
      id: "acc_create_1",
      persona: "My persona",
      role: "single_man" as const,
      social_provider: "buffer",
      external_account_id: "buf_channel_123",
      social_account_metadata: { foo: "bar" },
    };

    const parsedCreate = CreateAccountSchema.parse(createData);
    assert.equal(parsedCreate.social_provider, "buffer");
    assert.equal(parsedCreate.external_account_id, "buf_channel_123");
    assert.deepEqual(parsedCreate.social_account_metadata, { foo: "bar" });

    const updateData = {
      social_provider: null,
      external_account_id: null,
      social_account_metadata: { updated: true },
    };

    const parsedUpdate = UpdateAccountSchema.parse(updateData);
    assert.equal(parsedUpdate.social_provider, null);
    assert.equal(parsedUpdate.external_account_id, null);
    assert.deepEqual(parsedUpdate.social_account_metadata, { updated: true });
  });

  it("upsertAccount saves and returns zernio_api_key", async () => {
    const executedQueries: { text: string; values?: unknown[] }[] = [];
    let savedRow: any = null;

    const mockPool = {
      async query(textOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]) {
        const queryText = typeof textOrConfig === "string" ? textOrConfig : textOrConfig.text;
        const queryValues = typeof textOrConfig === "string" ? values : textOrConfig.values;
        executedQueries.push({ text: queryText, values: queryValues });

        if (queryText.includes("SELECT")) {
          if (savedRow && queryValues?.[0] === savedRow.id) {
            return { rows: [savedRow] };
          }
          return { rows: [] };
        }

        if (queryText.includes("INSERT INTO accounts")) {
          savedRow = {
            id: queryValues?.[0],
            display_name: queryValues?.[1],
            persona: queryValues?.[2],
            role: queryValues?.[3],
            enabled: queryValues?.[4],
            auto_post_enabled: queryValues?.[5],
            tiktok_open_id: queryValues?.[6],
            social_provider: queryValues?.[7],
            external_account_id: queryValues?.[8],
            social_account_metadata: queryValues?.[9] ? JSON.parse(queryValues[9] as string) : {},
            zernio_api_key: queryValues?.[10],
            created_at: new Date(),
            updated_at: new Date(),
          };
          return { rows: [savedRow] };
        }

        return { rows: [] };
      },
    } as unknown as Pool;

    const account = await upsertAccount(
      {
        id: "test-zernio-key-acc",
        persona: "Test",
        role: "single_woman",
        zernio_api_key: "zk_test_custom_key_123",
      } as any,
      mockPool
    );
    assert.strictEqual(account.zernio_api_key, "zk_test_custom_key_123");

    const fetched = await getAccount("test-zernio-key-acc", mockPool);
    assert.strictEqual(fetched?.zernio_api_key, "zk_test_custom_key_123");

    const insertQuery = executedQueries.find((q) => q.text.includes("INSERT INTO accounts"));
    assert.ok(insertQuery, "Expected INSERT INTO accounts query to be executed");
    assert.match(insertQuery.text, /zernio_api_key/);
  });

  it("AccountSchema, CreateAccountSchema, and UpdateAccountSchema accept zernio_api_key", () => {
    const createData = {
      id: "acc_zernio_create",
      role: "single_woman" as const,
      zernio_api_key: "zk_custom_key_456",
    };
    const parsedCreate = CreateAccountSchema.parse(createData);
    assert.equal(parsedCreate.zernio_api_key, "zk_custom_key_456");

    const updateData = {
      zernio_api_key: "zk_custom_key_789",
    };
    const parsedUpdate = UpdateAccountSchema.parse(updateData);
    assert.equal(parsedUpdate.zernio_api_key, "zk_custom_key_789");

    const updateNull = UpdateAccountSchema.parse({
      zernio_api_key: null,
    });
    assert.equal(updateNull.zernio_api_key, null);
  });
});
