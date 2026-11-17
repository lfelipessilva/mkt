import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSocialPublisherProvider } from '../../src/domain/social/factory.js';
import { AppError } from '../../src/shared/errors.js';

describe('Social Publisher Provider Factory', () => {
  it('returns zernio provider by default', () => {
    const provider = getSocialPublisherProvider();
    assert.equal(provider.providerName, 'zernio');
  });

  it('passes apiKey to zernio provider when provided', () => {
    const provider = getSocialPublisherProvider('zernio', { apiKey: 'zk_test_custom_key' });
    assert.equal(provider.providerName, 'zernio');
    assert.equal((provider as any).apiKey, 'zk_test_custom_key');
  });

  it('returns postforme when asked', () => {
    const provider = getSocialPublisherProvider('postforme');
    assert.equal(provider.providerName, 'postforme');
  });

  it('throws AppError(..., 400, "unsupported_provider") for unsupported provider', () => {
    assert.throws(
      () => getSocialPublisherProvider('unsupported_provider_xyz' as never),
      (err: unknown) => {
        assert(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'unsupported_provider');
        return true;
      }
    );
  });
});
