import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerOrdinaryTrustSetRoutes } from '../../dist/http/routes/ordinaryTrustSetRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';
import { MAX_ACCEPTED_TRUST_SET_CANONICAL_BYTES, MAX_ORDINARY_TRUST_SET_REQUEST_CANONICAL_BYTES,
  OrdinaryTrustSetError } from '../../dist/familytrustset/OrdinaryTrustSetService.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';

const BASE = '/api/device/families/family-one/trust-set/epochs';
function canonicalEpoch(familyId = 'family-one', trustSetEpoch = 2, keyEpoch = 1) {
  return canonicalizeTrustSetEpoch({ familyId, trustSetEpoch, keyEpoch,
    entries: [{ deviceId: 'device-one', role: 'OWNER', dskKeyId: 'dsk-one', dskPublicKey: 'dsk-public-one',
      dekKeyId: 'dek-one', dekPublicKey: 'dek-public-one', status: 'ACTIVE' }],
    issuedAt: new Date('2026-10-10T00:00:00.000Z'), supersedesEpoch: trustSetEpoch === 1 ? null : trustSetEpoch - 1 });
}
const HEAD = { canonicalEpochBase64: Buffer.from(canonicalEpoch()).toString('base64'), signatureBase64: Buffer.alloc(64, 1).toString('base64'),
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
  const submit = await request('POST', BASE, BODY);
  const status = await request('POST', `${BASE}/status`, BODY);
  const head = await request('GET', `${BASE}/head`);
  const history = await request('GET', `${BASE}/records/2`);
  for (const response of [submit, status, head, history]) {
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
  }
  assert.deepEqual(head.json(), { acceptedHead: HEAD });
  assert.deepEqual(history.json(), { acceptedEpoch: HEAD });
  assert.equal(calls.length, 4);
  for (const call of calls) assert.deepEqual(call[1], { familyId: 'family-one', deviceId: 'device-one', dskKeyId: 'dsk-one' });
});

test('device Trust Set denials are private and no-store before authentication or throttling', async (t) => {
  const { app, request } = fixture(t);
  const unauthorized = await app.inject({ method: 'GET', url: `${BASE}/head` });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.headers['cache-control'], 'private, no-store');

  // The earlier unauthenticated request also consumes this route bucket.
  for (let count = 0; count < 59; count += 1) {
    assert.equal((await request('GET', `${BASE}/head`)).statusCode, 200);
  }
  const throttled = await request('GET', `${BASE}/head`);
  assert.equal(throttled.statusCode, 429);
  assert.equal(throttled.headers['cache-control'], 'private, no-store');
});

test('success responses explicitly project accepted epoch DTOs and omit service metadata', async (t) => {
  const internalHead = { ...HEAD, storageVersion: 42, internalSecret: 'must-not-leak' };
  const { request } = fixture(t, { service: {
    submit: async () => ({ outcome: 'ACCEPTED', acceptedEpoch: internalHead, acceptedHead: internalHead, transactionId: 'private' }),
    status: async () => ({ outcome: 'ACCEPTED', acceptedEpoch: internalHead, acceptedHead: internalHead, diagnostic: 'private' }),
    head: async () => internalHead,
    epoch: async () => internalHead,
  } });
  const expectedDto = { ...HEAD };
  for (const [method, url, payload, expected] of [
    ['POST', BASE, BODY, { outcome: 'ACCEPTED', acceptedEpoch: expectedDto, acceptedHead: expectedDto }],
    ['POST', `${BASE}/status`, BODY, { outcome: 'ACCEPTED', acceptedEpoch: expectedDto, acceptedHead: expectedDto }],
    ['GET', `${BASE}/head`, undefined, { acceptedHead: expectedDto }],
    ['GET', `${BASE}/records/2`, undefined, { acceptedEpoch: expectedDto }],
  ]) {
    const result = await request(method, url, payload);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json(), expected);
    assert.ok(!result.body.includes('internalSecret') && !result.body.includes('must-not-leak'));
  }
});

test('accepted projections are bound to the authenticated family and canonical epoch metadata', async (t) => {
  const wrongFamilyHead = { ...HEAD, canonicalEpochBase64: Buffer.from(canonicalEpoch('family-two')).toString('base64') };
  const wrongMetadataHead = { ...HEAD, canonicalEpochBase64: Buffer.from(canonicalEpoch('family-one', 3, 2)).toString('base64') };
  const { request } = fixture(t, { service: {
    submit: async () => ({ outcome: 'ACCEPTED', acceptedEpoch: wrongFamilyHead, acceptedHead: wrongFamilyHead }),
    status: async () => ({ outcome: 'ACCEPTED', acceptedEpoch: wrongFamilyHead, acceptedHead: wrongFamilyHead }),
    head: async () => wrongFamilyHead,
    epoch: async () => wrongFamilyHead,
  } });
  for (const [method, url, payload] of [
    ['POST', BASE, BODY], ['POST', `${BASE}/status`, BODY], ['GET', `${BASE}/head`], ['GET', `${BASE}/records/2`],
  ]) {
    const result = await request(method, url, payload);
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
  }

  const metadataFixture = fixture(t, { service: { head: async () => wrongMetadataHead } });
  const metadataResult = await metadataFixture.request('GET', `${BASE}/head`);
  assert.equal(metadataResult.statusCode, 503);
  assert.deepEqual(metadataResult.json(), { error: 'trust_set_unavailable' });
});

test('accepted projections bind signer metadata to the canonical active Owner DSK', async (t) => {
  for (const wrongSigner of [
    { signerDeviceId: 'other-device', signerKeyId: 'dsk-one' },
    { signerDeviceId: 'device-one', signerKeyId: 'other-dsk' },
  ]) {
    const corruptHead = { ...HEAD, ...wrongSigner };
    const { request } = fixture(t, { service: {
      submit: async () => ({ outcome: 'ACCEPTED', acceptedEpoch: corruptHead, acceptedHead: corruptHead }),
      status: async () => ({ outcome: 'ACCEPTED', acceptedEpoch: corruptHead, acceptedHead: corruptHead }),
      head: async () => corruptHead,
      epoch: async () => corruptHead,
    } });
    for (const [method, url, payload] of [
      ['POST', BASE, BODY], ['POST', `${BASE}/status`, BODY], ['GET', `${BASE}/head`], ['GET', `${BASE}/records/2`],
    ]) {
      const result = await request(method, url, payload);
      assert.equal(result.statusCode, 503);
      assert.equal(result.headers['cache-control'], 'private, no-store');
      assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
    }
  }
});

test('current session DSK is passed unchanged to each scoped service operation', async (t) => {
  const { request, calls } = fixture(t, { sessionIdentity: { familyId: 'family-one', deviceId: 'device-one', dskKeyId: 'rotated-dsk' } });
  for (const [method, url, payload] of [
    ['POST', BASE, BODY], ['POST', `${BASE}/status`, BODY], ['GET', `${BASE}/head`], ['GET', `${BASE}/records/2`],
  ]) assert.equal((await request(method, url, payload)).statusCode, 200);
  assert.equal(calls.length, 4);
  for (const call of calls) assert.deepEqual(call[1], { familyId: 'family-one', deviceId: 'device-one', dskKeyId: 'rotated-dsk' });
});

test('accepted projections reject non-canonical P-256 signature scalars even when they have the right byte length', async (t) => {
  const highSSignature = Buffer.alloc(64);
  highSSignature[31] = 1;
  const p256Order = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
  Buffer.from((p256Order / 2n + 1n).toString(16).padStart(64, '0'), 'hex').copy(highSSignature, 32);
  const malformedSignatures = [Buffer.alloc(64), Buffer.alloc(64, 0xff), highSSignature];
  for (const signature of malformedSignatures) {
    const malformedHead = { ...HEAD, signatureBase64: signature.toString('base64') };
    const { request } = fixture(t, { service: {
      submit: async () => ({ outcome: 'ACCEPTED', acceptedEpoch: malformedHead, acceptedHead: malformedHead }),
      status: async () => ({ outcome: 'ACCEPTED', acceptedEpoch: malformedHead, acceptedHead: malformedHead }),
      head: async () => malformedHead,
      epoch: async () => malformedHead,
    } });
    for (const [method, url, payload] of [
      ['POST', BASE, BODY], ['POST', `${BASE}/status`, BODY], ['GET', `${BASE}/head`], ['GET', `${BASE}/records/2`],
    ]) {
      const result = await request(method, url, payload);
      assert.equal(result.statusCode, 503);
      assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
    }
  }
});

test('malformed nominal service success fails closed instead of claiming acceptance or returning another epoch', async (t) => {
  const { request } = fixture(t, { service: {
    submit: async () => ({ outcome: 'ACCEPTED', acceptedEpoch: null, acceptedHead: HEAD }),
    status: async () => ({ outcome: 'ACCEPTED', acceptedEpoch: null, acceptedHead: HEAD }),
    head: async () => ({ ...HEAD, signatureBase64: 'broken' }),
    epoch: async () => ({ ...HEAD, trustSetEpoch: 3 }),
  } });
  for (const [method, url, payload] of [
    ['POST', BASE, BODY],
    ['POST', `${BASE}/status`, BODY],
    ['GET', `${BASE}/head`, undefined],
    ['GET', `${BASE}/records/2`, undefined],
  ]) {
    const result = await request(method, url, payload);
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
  }
});

test('non-accepted status requires acceptedEpoch to be explicitly null', async (t) => {
  for (const outcome of ['NOT_ACCEPTED', 'CONFLICT']) {
    for (const acceptedEpoch of [undefined, { ...HEAD, signatureBase64: 'broken' }]) {
      await t.test(`${outcome} rejects ${acceptedEpoch === undefined ? 'missing' : 'malformed'} acceptedEpoch`, async (subtest) => {
        const serviceResult = { outcome, acceptedHead: HEAD };
        if (acceptedEpoch !== undefined) serviceResult.acceptedEpoch = acceptedEpoch;
        const { request } = fixture(subtest, { service: { status: async () => serviceResult } });
        const result = await request('POST', `${BASE}/status`, BODY);
        assert.equal(result.statusCode, 503);
        assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
      });
    }
  }
});

test('status rejects a non-string outcome even when it coerces to NOT_ACCEPTED', async (t) => {
  const coercibleOutcome = { toString: () => 'NOT_ACCEPTED' };
  const { request } = fixture(t, {
    service: {
      status: async () => ({ outcome: coercibleOutcome, acceptedEpoch: null, acceptedHead: HEAD }),
    },
  });
  const result = await request('POST', `${BASE}/status`, BODY);
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
});

test('status projection rejects impossible NOT_ACCEPTED/CONFLICT receipts against the accepted head', async (t) => {
  const candidateAtHead = BODY;
  const futureBody = {
    canonicalEpochBase64: Buffer.from(canonicalEpoch('family-one', 3, 2)).toString('base64'),
    signatureBase64: Buffer.alloc(64, 3).toString('base64'),
  };
  const conflictingAtHead = {
    canonicalEpochBase64: Buffer.from(canonicalEpoch('family-one', 2, 1).replace('2026-10-10T00:00:00.000Z', '2026-10-10T00:00:01.000Z')).toString('base64'),
    signatureBase64: Buffer.alloc(64, 2).toString('base64'),
  };

  for (const [label, outcome, body] of [
    ['NOT_ACCEPTED at the accepted head', 'NOT_ACCEPTED', candidateAtHead],
    ['CONFLICT for the exact accepted head', 'CONFLICT', candidateAtHead],
    ['CONFLICT above the accepted head', 'CONFLICT', futureBody],
  ]) {
    await t.test(label, async (subtest) => {
      const { request } = fixture(subtest, { service: {
        status: async () => ({ outcome, acceptedEpoch: null, acceptedHead: HEAD }),
      } });
      const result = await request('POST', `${BASE}/status`, body);
      assert.equal(result.statusCode, 503);
      assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
    });
  }

  const { request } = fixture(t, { service: {
    status: async () => ({ outcome: 'CONFLICT', acceptedEpoch: null, acceptedHead: HEAD }),
  } });
  const validConflict = await request('POST', `${BASE}/status`, conflictingAtHead);
  assert.equal(validConflict.statusCode, 200);
  assert.deepEqual(validConflict.json(), { outcome: 'CONFLICT', acceptedEpoch: null, acceptedHead: HEAD });

  const futureNotAccepted = fixture(t, { service: {
    status: async () => ({ outcome: 'NOT_ACCEPTED', acceptedEpoch: null, acceptedHead: HEAD }),
  } });
  const validNotAccepted = await futureNotAccepted.request('POST', `${BASE}/status`, futureBody);
  assert.equal(validNotAccepted.statusCode, 200);
  assert.deepEqual(validNotAccepted.json(), { outcome: 'NOT_ACCEPTED', acceptedEpoch: null, acceptedHead: HEAD });

  const lowerMissingBody = {
    canonicalEpochBase64: Buffer.from(canonicalEpoch('family-one', 1, 1)).toString('base64'),
    signatureBase64: Buffer.alloc(64, 1).toString('base64'),
  };
  const lowerNotAccepted = fixture(t, { service: {
    status: async () => ({ outcome: 'NOT_ACCEPTED', acceptedEpoch: null, acceptedHead: HEAD }),
  } });
  const validLowerNotAccepted = await lowerNotAccepted.request('POST', `${BASE}/status`, lowerMissingBody);
  assert.equal(validLowerNotAccepted.statusCode, 200);
  assert.deepEqual(validLowerNotAccepted.json(), { outcome: 'NOT_ACCEPTED', acceptedEpoch: null, acceptedHead: HEAD });
});

test('accepted submit and status receipts must exactly match the submitted canonical bytes and signature', async (t) => {
  const laterHead = { ...HEAD, canonicalEpochBase64: Buffer.from(canonicalEpoch('family-one', 3, 2)).toString('base64'), signatureBase64: Buffer.alloc(64, 3).toString('base64'),
    trustSetEpoch: 3, keyEpoch: 2 };
  for (const [operation, acceptedEpoch] of [
    ['submit', { ...HEAD, canonicalEpochBase64: Buffer.from(canonicalEpoch('family-one', 3, 2)).toString('base64'), trustSetEpoch: 3, keyEpoch: 2 }],
    ['status', { ...HEAD, signatureBase64: Buffer.alloc(64, 2).toString('base64') }],
  ]) {
    const { request } = fixture(t, { service: {
      [operation]: async () => ({ outcome: 'ACCEPTED', acceptedEpoch, acceptedHead: laterHead }),
    } });
    const result = await request('POST', operation === 'submit' ? BASE : `${BASE}/status`, BODY);
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
  }
});

test('accepted epoch and head at the same trust-set epoch must identify the exact same record', async (t) => {
  const contradictoryHead = { ...HEAD, signatureBase64: Buffer.alloc(64, 2).toString('base64') };
  for (const operation of ['submit', 'status']) {
    const { request } = fixture(t, { service: {
      [operation]: async () => ({ outcome: 'ACCEPTED', acceptedEpoch: HEAD, acceptedHead: contradictoryHead }),
    } });
    const result = await request('POST', operation === 'submit' ? BASE : `${BASE}/status`, BODY);
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
  }
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
    assert.equal(result.headers['cache-control'], 'private, no-store');
  }
  assert.equal(calls.length, 0);
});

test('exact body fields and length limits reject caller authority or receive timestamps', async (t) => {
  const { request, calls } = fixture(t);
  for (const payload of [[], {}, { ...BODY, deviceId: 'forged' }, { ...BODY, receivedAt: '2026-10-09T00:00:00Z' },
    { ...BODY, signatureBase64: 'tiny' }, { ...BODY, canonicalEpochBase64: 'x' }]) {
    const submit = await request('POST', BASE, payload);
    const status = await request('POST', `${BASE}/status`, payload);
    assert.equal(submit.statusCode, 400);
    assert.equal(status.statusCode, 400);
    assert.equal(submit.headers['cache-control'], 'private, no-store');
    assert.equal(status.headers['cache-control'], 'private, no-store');
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
  assert.equal(absent.headers['cache-control'], 'private, no-store');
  assert.equal(calls.length, 1);
});

test('current membership/owner failures are forbidden, conflicts and genesis are rejected', async (t) => {
  for (const [code, status] of [['INVALID_REQUEST', 400], ['DEVICE_NOT_ACTIVE', 403], ['OWNER_REQUIRED', 403],
    ['FAMILY_MISMATCH', 403], ['NO_TRUST_SET', 409], ['GENESIS_NOT_ALLOWED', 409], ['CONFLICT', 409], ['REJECTED', 409]]) {
    const { request } = fixture(t, { service: { submit: async () => { throw new OrdinaryTrustSetError(code); } } });
    const result = await request('POST', BASE, BODY);
    assert.equal(result.statusCode, status);
    assert.equal(result.headers['cache-control'], 'private, no-store');
  }
});

test('unconfigured production facade and storage/auth infrastructure failures stay unavailable without details', async (t) => {
  for (const options of [{ unconfigured: true }, { authFailure: new Error('secret session database detail') },
    { service: { head: async () => { throw new Error('secret signed bytes corrupt'); } } }]) {
    const { request } = fixture(t, options);
    const result = await request('GET', `${BASE}/head`);
    assert.equal(result.statusCode, 503); assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
    assert.equal(result.headers['cache-control'], 'private, no-store');
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
    assert.equal(result.headers['cache-control'], 'private, no-store');
    assert.deepEqual(result.json(), { error: 'trust_set_rejected' });
    assert.ok(!result.body.includes('signature') && !result.body.includes('key'));
  }
});

test('body limit prevents oversized canonical payload reaching service', async (t) => {
  const { request, calls } = fixture(t);
  const result = await request('POST', BASE, { ...BODY, canonicalEpochBase64: 'A'.repeat(370000) });
  assert.equal(result.statusCode, 413);
  assert.equal(result.headers['cache-control'], 'private, no-store');
  assert.equal(calls.length, 0);
});

test('maximum canonical epoch transport fits the global body ceiling and the next byte is rejected before service use', async (t) => {
  let receivedBody;
  let submitCalls = 0;
  const { request } = fixture(t, { service: {
    submit: async (_scope, body) => {
      submitCalls += 1;
      receivedBody = body;
      const acceptedEpoch = { ...HEAD, canonicalEpochBase64: body.canonicalEpochBase64 };
      return { outcome: 'ACCEPTED', acceptedEpoch, acceptedHead: acceptedEpoch };
    },
  } });
  const canonicalEpochBase64 = Buffer.alloc(MAX_ORDINARY_TRUST_SET_REQUEST_CANONICAL_BYTES, 7).toString('base64');
  assert.equal(canonicalEpochBase64.length, 262_008);
  const maximumRequest = { ...BODY, canonicalEpochBase64 };
  assert.equal(Buffer.byteLength(JSON.stringify(maximumRequest)), 256 * 1024);
  const result = await request('POST', BASE, maximumRequest);
  assert.equal(result.statusCode, 503, 'malformed accepted bytes must not be projected as an accepted receipt');
  assert.equal(receivedBody.canonicalEpochBase64.length, 262_008);
  assert.equal(submitCalls, 1);

  const oversizedRequest = {
    ...BODY,
    canonicalEpochBase64: Buffer.alloc(MAX_ORDINARY_TRUST_SET_REQUEST_CANONICAL_BYTES + 1, 7).toString('base64'),
  };
  assert.equal(Buffer.byteLength(JSON.stringify(oversizedRequest)), 256 * 1024 + 4);
  const rejected = await request('POST', BASE, oversizedRequest);
  assert.equal(rejected.statusCode, 413);
  assert.equal(rejected.headers['cache-control'], 'private, no-store');
  assert.equal(submitCalls, 1, 'the over-limit body must not reach the acceptance service');
});

test('accepted-head projection rejects structurally invalid canonical bytes within the general byte bound', async (t) => {
  const canonicalEpochBase64 = Buffer.alloc(MAX_ORDINARY_TRUST_SET_REQUEST_CANONICAL_BYTES + 1, 7).toString('base64');
  assert.ok(Buffer.from(canonicalEpochBase64, 'base64').length <= MAX_ACCEPTED_TRUST_SET_CANONICAL_BYTES);
  const acceptedBootstrapHead = { ...HEAD, canonicalEpochBase64, trustSetEpoch: 1, keyEpoch: 1 };
  const { request } = fixture(t, { service: { head: async () => acceptedBootstrapHead } });
  const result = await request('GET', `${BASE}/head`);
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.json(), { error: 'trust_set_unavailable' });
});

test('independent route buckets throttle submission without exhausting read/status budgets', async (t) => {
  const { request } = fixture(t);
  for (let count = 0; count < 30; count++) assert.equal((await request('POST', BASE, BODY)).statusCode, 200);
  assert.equal((await request('POST', BASE, BODY)).statusCode, 429);
  assert.equal((await request('POST', `${BASE}/status`, BODY)).statusCode, 200);
  assert.equal((await request('GET', `${BASE}/head`)).statusCode, 200);
});
