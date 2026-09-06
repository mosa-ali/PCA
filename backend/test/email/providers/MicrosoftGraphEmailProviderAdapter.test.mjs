import assert from 'node:assert/strict';
import test from 'node:test';
import { MicrosoftGraphEmailProviderAdapter } from '../../../dist/email/providers/MicrosoftGraphEmailProviderAdapter.js';
import { EmailDeliveryError } from '../../../dist/email/EmailProviderAdapter.js';

const CONFIG = {
  tenantId: 'tenant-id',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  senderUserId: 'no-reply@pcasafe.com',
  fromAddress: 'no-reply@pcasafe.com',
  fromName: 'PCA',
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('fakeFetch: no more scripted responses');
    return next;
  };
  fn.calls = calls;
  return fn;
}

test('acquires a token then sends, returning a providerMessageId on HTTP 202', async () => {
  const fetchImpl = fakeFetch([
    jsonResponse(200, { access_token: 'tok-1', expires_in: 3600 }),
    { ok: false, status: 202, json: async () => ({}) },
  ]);
  const adapter = new MicrosoftGraphEmailProviderAdapter(CONFIG, fetchImpl, () => 1_000_000);
  const result = await adapter.send({ toEmail: 'someone@example.com', subject: 'Subject', text: 'text', html: '<p>html</p>' });
  assert.equal(typeof result.providerMessageId, 'string');
  assert.ok(result.providerMessageId.length > 0);

  assert.equal(fetchImpl.calls.length, 2);
  assert.match(fetchImpl.calls[0].url, /login\.microsoftonline\.com\/tenant-id/);
  assert.match(fetchImpl.calls[1].url, /graph\.microsoft\.com.*users\/no-reply%40pcasafe\.com\/sendMail/);
  assert.match(fetchImpl.calls[1].init.headers.authorization, /^Bearer tok-1$/);
});

test('caches the access token across sends until it is near expiry', async () => {
  const fetchImpl = fakeFetch([
    jsonResponse(200, { access_token: 'tok-1', expires_in: 3600 }),
    { ok: false, status: 202, json: async () => ({}) },
    { ok: false, status: 202, json: async () => ({}) },
  ]);
  let now = 1_000_000;
  const adapter = new MicrosoftGraphEmailProviderAdapter(CONFIG, fetchImpl, () => now);
  await adapter.send({ toEmail: 'a@b.com', subject: 's', text: 't', html: '<p>h</p>' });
  now += 1000; // still well inside the cached token's lifetime
  await adapter.send({ toEmail: 'a@b.com', subject: 's', text: 't', html: '<p>h</p>' });
  // Only ONE token request total across both sends.
  assert.equal(fetchImpl.calls.filter((c) => c.url.includes('oauth2')).length, 1);
});

test('re-acquires a token once the cached one is within the expiry safety margin', async () => {
  const fetchImpl = fakeFetch([
    jsonResponse(200, { access_token: 'tok-1', expires_in: 3600 }),
    { ok: false, status: 202, json: async () => ({}) },
    jsonResponse(200, { access_token: 'tok-2', expires_in: 3600 }),
    { ok: false, status: 202, json: async () => ({}) },
  ]);
  let now = 1_000_000;
  const adapter = new MicrosoftGraphEmailProviderAdapter(CONFIG, fetchImpl, () => now);
  await adapter.send({ toEmail: 'a@b.com', subject: 's', text: 't', html: '<p>h</p>' });
  now += 3600 * 1000; // well past expiry
  await adapter.send({ toEmail: 'a@b.com', subject: 's', text: 't', html: '<p>h</p>' });
  assert.equal(fetchImpl.calls.filter((c) => c.url.includes('oauth2')).length, 2);
});

test('SECURITY: token request failure surfaces as EmailDeliveryError, retryable for 5xx/429', async () => {
  const fetchImpl = fakeFetch([{ ok: false, status: 503, json: async () => ({}) }]);
  const adapter = new MicrosoftGraphEmailProviderAdapter(CONFIG, fetchImpl, () => 1_000_000);
  await assert.rejects(
    () => adapter.send({ toEmail: 'a@b.com', subject: 's', text: 't', html: '<p>h</p>' }),
    (error) => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test('a 4xx sendMail response is a non-retryable EmailDeliveryError', async () => {
  const fetchImpl = fakeFetch([jsonResponse(200, { access_token: 'tok-1', expires_in: 3600 }), { ok: false, status: 403, json: async () => ({}) }]);
  const adapter = new MicrosoftGraphEmailProviderAdapter(CONFIG, fetchImpl, () => 1_000_000);
  await assert.rejects(
    () => adapter.send({ toEmail: 'a@b.com', subject: 's', text: 't', html: '<p>h</p>' }),
    (error) => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test('a 429 (throttled) sendMail response is retryable', async () => {
  const fetchImpl = fakeFetch([jsonResponse(200, { access_token: 'tok-1', expires_in: 3600 }), { ok: false, status: 429, json: async () => ({}) }]);
  const adapter = new MicrosoftGraphEmailProviderAdapter(CONFIG, fetchImpl, () => 1_000_000);
  await assert.rejects(
    () => adapter.send({ toEmail: 'a@b.com', subject: 's', text: 't', html: '<p>h</p>' }),
    (error) => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

// PCA-DW-W2-R1-10: sender identity correctness -- senderUserId (URL-path
// mailbox identifier) must never leak into the "From" field, and vice
// versa a validated fromAddress must never be used as the URL-path
// identifier.
test('SECURITY: the "From" field uses fromAddress, never senderUserId, even when they differ (UPN mailbox identifier case)', async () => {
  const config = { ...CONFIG, senderUserId: 'mailbox-alias@pcasafe.com', fromAddress: 'no-reply@pcasafe.com' };
  const fetchImpl = fakeFetch([jsonResponse(200, { access_token: 'tok-1', expires_in: 3600 }), { ok: false, status: 202, json: async () => ({}) }]);
  const adapter = new MicrosoftGraphEmailProviderAdapter(config, fetchImpl, () => 1_000_000);
  await adapter.send({ toEmail: 'someone@example.com', subject: 's', text: 't', html: '<p>h</p>' });
  const sendCall = fetchImpl.calls[1];
  assert.match(sendCall.url, /users\/mailbox-alias%40pcasafe\.com\/sendMail/, 'URL path must use senderUserId');
  const body = JSON.parse(sendCall.init.body);
  assert.equal(body.message.from.emailAddress.address, 'no-reply@pcasafe.com', '"From" must use fromAddress, never senderUserId');
});

test('SECURITY: a GUID/object-id senderUserId (mailbox identifier) is used only in the URL path -- the "From" field still uses the validated email fromAddress, never the GUID', async () => {
  const guidMailboxId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const config = { ...CONFIG, senderUserId: guidMailboxId, fromAddress: 'no-reply@pcasafe.com' };
  const fetchImpl = fakeFetch([jsonResponse(200, { access_token: 'tok-1', expires_in: 3600 }), { ok: false, status: 202, json: async () => ({}) }]);
  const adapter = new MicrosoftGraphEmailProviderAdapter(config, fetchImpl, () => 1_000_000);
  await adapter.send({ toEmail: 'someone@example.com', subject: 's', text: 't', html: '<p>h</p>' });
  const sendCall = fetchImpl.calls[1];
  assert.match(sendCall.url, new RegExp(`users/${guidMailboxId}/sendMail`), 'URL path must use the GUID senderUserId');
  const body = JSON.parse(sendCall.init.body);
  assert.equal(body.message.from.emailAddress.address, 'no-reply@pcasafe.com', 'the GUID must never be serialized as the "From" email address');
  assert.notEqual(body.message.from.emailAddress.address, guidMailboxId);
});

// PCA-DW-W2-R1-6: a provider call that never resolves must still fail,
// bounded, as a retryable timeout -- never hang indefinitely (which would
// let it outlive the outbox claim lease it must stay inside of).
test('SECURITY: a hanging token request times out as a retryable EMAIL_PROVIDER_TIMEOUT, bounded by the adapter\'s own timeout, not left to hang', async () => {
  const neverResolvingFetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  const adapter = new MicrosoftGraphEmailProviderAdapter(CONFIG, neverResolvingFetch, () => 1_000_000, 50);
  await assert.rejects(
    () => adapter.send({ toEmail: 'a@b.com', subject: 's', text: 't', html: '<p>h</p>' }),
    (error) => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.retryable, true);
      assert.equal(error.category, 'EMAIL_PROVIDER_TIMEOUT');
      return true;
    },
  );
});
