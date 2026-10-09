import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerOrdinaryTrustSetRoutes } from '../../dist/http/routes/ordinaryTrustSetRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';
import { OrdinaryTrustSetError } from '../../dist/familytrustset/OrdinaryTrustSetService.js';

const BASE = '/api/device/families/family-one/trust-set/epochs';
const HEAD = { canonicalEpochBase64: 'Ynl0ZXM=', signatureBase64: Buffer.alloc(64, 1).toString('base64'),
  signerDeviceId: 'device-one', signerKeyId: 'dsk-one', trustSetEpoch: 2, keyEpoch: 1 };
const BODY = { canonicalEpochBase64: HEAD.canonicalEpochBase64, signatureBase64: HEAD.signatureBase64 };
function fixture(t, options = {}) {
  const calls = []; const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  const service = {
    submit: async (scope, body) => { calls.push(['submit', scope, body]); return { outcome: 'ACCEPTED', acceptedEpoch: HEAD, acceptedHead: HEAD }; },
    status: async (scope, body) => { calls.push(['status', scope, body]); return { outcome: 'ACCEPTED', acceptedEpoch: HEAD, acceptedHead: HEAD }; },
    head: async (scope) => { calls.push(['head', scope]); return HEAD; },
    epoch: async (scope, epoch) => { calls.push(['epoch', scope, epoch]); return epoch === 2 ? HEAD : null; },
    ...options.service,
  };
  const sessions = {
    validateSession: async (token) => {
      if (options.authFailure) throw options.authFailure;
      if (token !== 'verified-device-session') throw new RuntimeSyncAuthError('UNAUTHORIZED');
      return options.sessionIdentity ?? { familyId: 'family-one', deviceId: 'device-one', dskKeyId: 'dsk-one' };
    },
  };
  registerOrdinaryTrustSetRoutes(app, { deviceSessionService: sessions,
    ordinaryTrustSetService: options.unconfigured ? undefined : service, rateLimiter: createRateLimiter() });
  t.after(() => app.close());
  const request = (method, url, payload, headers = {}) => app.inject({ method, url, payload,
    headers: { authorization: 'Bearer verified-device-session', ...headers } });
  return { app, calls, request };
}

test('verified device session supplies immutable family/device scope for all four endpoints', async (t) => {
  const { request, calls } = fixture(t);
  assert.equal((await request('POST', BASE, BODY)).statusCode, 200);
  assert.equal((await request('POST', `${BASE}/status`, BODY)).statusCode, 200);
  assert.deepEqual((await request('GET', `${BASE}/head`)).json(), { acceptedHead: HEAD });
  assert.deepEqual((await request('GET', `${BASE}/records/2`)).json(), { acceptedEpoch: HEAD });
  assert.equal(calls.length, 4);
  for (const call of calls) assert.deepEqual(call[1], { familyId: 'family-one', deviceId: 'device-one', dskKeyId: 'dsk-one' });
});

test('route fails closed when validated session identity omits its DSK binding', async (t) => {
  const { request, calls } = fixture(t, { sessionIdentity: { familyId: 'family-one', deviceId: 'device-one' } });
  const result = await request('GET', `${BASE}/head`);
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
  assert.equal(calls.length, 0);
});

test('Parent cookies, csrf, forged body identities and unverified bearer cannot authorize', async (t) => {
  const { app, calls } = fixture(t);
  for (const authorization of [undefined, 'Basic abc', 'Bearer ', 'Bearer forged', `Bearer ${'a'.repeat(4100)}`]) {
    const result = await app.inject({ method: 'POST', url: BASE, payload: BODY,
      headers: { ...(authorization ? { authorization } : {}), cookie: 'parent_session=valid-parent; csrf=valid', 'x-csrf-token': 'valid' } });
    assert.equal(result.statusCode, 401); assert.deepEqual(result.json(), { error: 'unauthorized' });
  }
  assert.equal(calls.length, 0);
});

test('path family cannot override authenticated scope for submit/status/head/history', async (t) => {
  const { request, calls } = fixture(t);
  const foreign = BASE.replace('family-one', 'foreign');
  for (const [method, url] of [['POST', foreign], ['POST', `${foreign}/status`], ['GET', `${foreign}/head`], ['GET', `${foreign}/records/2`]]) {
    const result = await request(method, url, method === 'POST' ? BODY : undefined);
    assert.equal(result.statusCode, 403); assert.deepEqual(result.json(), { error: 'forbidden' });
  }
  assert.equal(calls.length, 0);
});

test('exact body fields and length limits reject caller authority or receive timestamps', async (t) => {
  const { request, calls } = fixture(t);
  for (const payload of [[], {}, { ...BODY, deviceId: 'forged' }, { ...BODY, receivedAt: '2026-10-09T00:00:00Z' },
    { ...BODY, signatureBase64: 'tiny' }, { ...BODY, canonicalEpochBase64: 'x' }]) {
    assert.equal((await request('POST', BASE, payload)).statusCode, 400);
    assert.equal((await request('POST', `${BASE}/status`, payload)).statusCode, 400);
  }
  assert.equal(calls.length, 0);
});

test('indexed record bounds are canonical positive supported integers and absence is 404', async (t) => {
  const { request, calls } = fixture(t);
  for (const value of ['0', '01', '-1', '1.0', '1e2', '2147483648', '99999999999']) {
    assert.equal((await request('GET', `${BASE}/records/${value}`)).statusCode, 400);
  }
  const absent = await request('GET', `${BASE}/records/3`);
  assert.equal(absent.statusCode, 404); assert.deepEqual(absent.json(), { error: 'trust_set_record_unavailable' });
  assert.equal(calls.length, 1);
});

test('current membership/owner failures are forbidden, conflicts and genesis are rejected', async (t) => {
  for (const [code, status] of [['INVALID_REQUEST', 400], ['DEVICE_NOT_ACTIVE', 403], ['OWNER_REQUIRED', 403],
    ['FAMILY_MISMATCH', 403], ['NO_TRUST_SET', 409], ['GENESIS_NOT_ALLOWED', 409], ['CONFLICT', 409], ['REJECTED', 409]]) {
    const { request } = fixture(t, { service: { submit: async () => { throw new OrdinaryTrustSetError(code); } } });
    assert.equal((await request('POST', BASE, BODY)).statusCode, status);
  }
});

test('unconfigured production facade and storage/auth infrastructure failures stay unavailable without details', async (t) => {
  for (const options of [{ unconfigured: true }, { authFailure: new Error('secret session database detail') },
    { service: { head: async () => { throw new Error('secret signed bytes corrupt'); } } }]) {
    const { request } = fixture(t, options);
    const result = await request('GET', `${BASE}/head`);
    assert.equal(result.statusCode, 503); assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
    assert.ok(!result.body.includes('secret'));
  }
});

test('real facade missing-record error remains 404 rather than a conflict', async (t) => {
  const { request } = fixture(t, { service: { epoch: async () => { throw new OrdinaryTrustSetError('EPOCH_NOT_FOUND'); } } });
  const result = await request('GET', `${BASE}/records/3`);
  assert.equal(result.statusCode, 404);
  assert.deepEqual(result.json(), { error: 'trust_set_record_unavailable' });
});

test('accepted-head integrity rejection stays generic across submit, status, head, and history routes', async (t) => {
  const rejectCorruptHead = async () => { throw new OrdinaryTrustSetError('NO_TRUST_SET'); };
  const { request } = fixture(t, { service: {
    submit: rejectCorruptHead, status: rejectCorruptHead, head: rejectCorruptHead, epoch: rejectCorruptHead,
  } });
  for (const [method, url, payload] of [
    ['POST', BASE, BODY],
    ['POST', `${BASE}/status`, BODY],
    ['GET', `${BASE}/head`, undefined],
    ['GET', `${BASE}/records/2`, undefined],
  ]) {
    const result = await request(method, url, payload);
    assert.equal(result.statusCode, 409);
    assert.deepEqual(result.json(), { error: 'trust_set_rejected' });
    assert.ok(!result.body.includes('signature') && !result.body.includes('key'));
  }
});

test('body limit prevents oversized canonical payload reaching service', async (t) => {
  const { request, calls } = fixture(t);
  const result = await request('POST', BASE, { ...BODY, canonicalEpochBase64: 'A'.repeat(370000) });
  assert.equal(result.statusCode, 413); assert.equal(calls.length, 0);
});

test('route override accepts maximum-sized canonical epoch transport under the ordinary global body limit', async (t) => {
  const { request, calls } = fixture(t);
  const canonicalEpochBase64 = Buffer.alloc(256 * 1024, 7).toString('base64');
  assert.equal(canonicalEpochBase64.length, 349_528);
  const result = await request('POST', BASE, { ...BODY, canonicalEpochBase64 });
  assert.equal(result.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].canonicalEpochBase64.length, 349_528);
});

test('independent route buckets throttle submission without exhausting read/status budgets', async (t) => {
  const { request } = fixture(t);
  for (let count = 0; count < 30; count++) assert.equal((await request('POST', BASE, BODY)).statusCode, 200);
  assert.equal((await request('POST', BASE, BODY)).statusCode, 429);
  assert.equal((await request('POST', `${BASE}/status`, BODY)).statusCode, 200);
  assert.equal((await request('GET', `${BASE}/head`)).statusCode, 200);
});
