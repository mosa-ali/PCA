import assert from 'node:assert/strict';
import test from 'node:test';
import { RejectingEmailProviderAdapter } from '../../dist/email/providers/RejectingEmailProviderAdapter.js';
import { EmailDeliveryError } from '../../dist/email/EmailProviderAdapter.js';

test('every send attempt rejects with a retryable EmailDeliveryError -- never silently succeeds, but still gives a since-configured provider a chance within the retry window', async () => {
  const adapter = new RejectingEmailProviderAdapter();
  await assert.rejects(
    () => adapter.send({ toEmail: 'a@b.com', subject: 's', text: 't', html: '<p>h</p>' }),
    (error) => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});
