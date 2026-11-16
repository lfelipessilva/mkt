import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSocialPublisherProvider } from '../../src/domain/social/factory.js';
import { AppError } from '../../src/shared/errors.js';

describe('Social Publisher Provider Factory', () => {
  it('returns buffer provider instance with providerName === "buffer"', () => {
    const provider = getSocialPublisherProvider('buffer');
    assert.equal(provider.providerName, 'buffer');
  });

  it('resolves default provider from process.env.SOCIAL_PROVIDER or fallback to "buffer"', () => {
    const originalEnv = process.env.SOCIAL_PROVIDER;
    try {
      delete process.env.SOCIAL_PROVIDER;
      const defaultProvider = getSocialPublisherProvider();
      assert.equal(defaultProvider.providerName, 'buffer');

      process.env.SOCIAL_PROVIDER = 'buffer';
      const envProvider = getSocialPublisherProvider();
      assert.equal(envProvider.providerName, 'buffer');
    } finally {
      if (originalEnv !== undefined) {
        process.env.SOCIAL_PROVIDER = originalEnv;
      } else {
        delete process.env.SOCIAL_PROVIDER;
      }
    }
  });

  it('throws AppError(..., 400, "unsupported_provider") for unsupported provider', () => {
    assert.throws(
      () => getSocialPublisherProvider('unsupported_provider_xyz' as any),
      (err: unknown) => {
        assert(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'unsupported_provider');
        return true;
      }
    );
  });
});
