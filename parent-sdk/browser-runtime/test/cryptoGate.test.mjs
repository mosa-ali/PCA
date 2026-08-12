import assert from 'node:assert/strict';
import test from 'node:test';
import { getCryptoGateDecision, isCryptoReviewApproved, NotReadyDecryptor, CryptoReviewRequiredError } from '../dist/cryptoGate.js';

test('crypto gate reports NOT_READY_CRYPTO_REVIEW today', () => {
  const decision = getCryptoGateDecision();
  assert.equal(decision.status, 'NOT_READY_CRYPTO_REVIEW');
  assert.equal(isCryptoReviewApproved(), false);
});

test('NotReadyDecryptor never returns data -- it always throws CryptoReviewRequiredError', async () => {
  const decryptor = new NotReadyDecryptor();
  await assert.rejects(() => decryptor.decrypt('c3VwZXItc2VjcmV0'), (err) => {
    assert.ok(err instanceof CryptoReviewRequiredError);
    assert.equal(err.code, 'NOT_READY_CRYPTO_REVIEW');
    return true;
  });
});
