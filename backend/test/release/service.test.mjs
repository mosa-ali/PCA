import assert from 'node:assert/strict';
import test from 'node:test';
import { ReleaseService, ReleaseError } from '../../dist/release/ReleaseService.js';
import { MAX_SIGNED_METADATA_BYTES } from '../../dist/release/policy.js';
import { createInMemoryReleaseRepository } from '../support/inMemoryReleaseRepository.mjs';

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

function buildService() {
  const repository = createInMemoryReleaseRepository();
  let currentTime = BASE_TIME;
  const clock = { now: () => new Date(currentTime), advance: (ms) => { currentTime += ms; } };
  const service = new ReleaseService(repository, clock.now);
  return { service, repository, clock };
}

function release(overrides = {}) {
  return {
    packageType: 'ANDROID_APP',
    platform: 'ANDROID',
    version: '1.0.0',
    artifactDigest: DIGEST_A,
    artifactSizeBytes: 1024,
    signingKeyId: 'signing-key-2026-01',
    signedMetadata: Buffer.from('externally-signed-metadata-blob'),
    ...overrides,
  };
}

test('valid release metadata is accepted', async () => {
  const { service } = buildService();
  const record = await service.publishRelease(release());
  assert.equal(record.state, 'PUBLISHED');
  assert.equal(record.releaseId, 'ANDROID_APP:ANDROID:1.0.0');
});

test('invalid platform rejected', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.publishRelease(release({ platform: 'WINDOWS' })), { code: 'INVALID_INPUT' });
});

test('invalid package type rejected', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.publishRelease(release({ packageType: 'DESKTOP_APP' })), { code: 'INVALID_INPUT' });
});

test('mismatched package type / platform combination rejected (e.g. IOS_APP on ANDROID)', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.publishRelease(release({ packageType: 'IOS_APP', platform: 'ANDROID' })),
    { code: 'INVALID_INPUT' },
  );
});

test('model/rule packages may be SHARED across platforms', async () => {
  const { service } = buildService();
  const record = await service.publishRelease(release({ packageType: 'RULE_PACKAGE', platform: 'SHARED', version: '1.0.0' }));
  assert.equal(record.platform, 'SHARED');
});

test('malformed version rejected', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.publishRelease(release({ version: '1.0' })), { code: 'INVALID_INPUT' });
  await assert.rejects(() => service.publishRelease(release({ version: 'v1.0.0' })), { code: 'INVALID_INPUT' });
});

test('invalid digest (wrong length / non-hex / uppercase) rejected', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.publishRelease(release({ artifactDigest: 'abc123' })), { code: 'INVALID_INPUT' });
  await assert.rejects(() => service.publishRelease(release({ artifactDigest: 'g'.repeat(64) })), { code: 'INVALID_INPUT' });
  await assert.rejects(() => service.publishRelease(release({ artifactDigest: 'A'.repeat(64) })), { code: 'INVALID_INPUT' });
});

test('empty digest rejected', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.publishRelease(release({ artifactDigest: '' })), { code: 'INVALID_INPUT' });
});

test('negative, zero, and non-finite artifact size rejected', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.publishRelease(release({ artifactSizeBytes: -1 })), { code: 'INVALID_INPUT' });
  await assert.rejects(() => service.publishRelease(release({ artifactSizeBytes: 0 })), { code: 'INVALID_INPUT' });
  await assert.rejects(() => service.publishRelease(release({ artifactSizeBytes: Number.NaN })), { code: 'INVALID_INPUT' });
  await assert.rejects(() => service.publishRelease(release({ artifactSizeBytes: Number.POSITIVE_INFINITY })), { code: 'INVALID_INPUT' });
});

test('oversized signed-metadata blob rejected', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.publishRelease(release({ signedMetadata: Buffer.alloc(MAX_SIGNED_METADATA_BYTES + 1) })),
    { code: 'INVALID_INPUT' },
  );
});

test('empty signed-metadata blob rejected', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.publishRelease(release({ signedMetadata: Buffer.alloc(0) })), { code: 'INVALID_INPUT' });
});

test('duplicate identical publication is idempotent', async () => {
  const { service } = buildService();
  const input = release();
  const first = await service.publishRelease(input);
  const second = await service.publishRelease({ ...input, signedMetadata: Buffer.from(input.signedMetadata) });
  assert.equal(first.releaseId, second.releaseId);
  assert.equal(first.artifactDigest, second.artifactDigest);
});

test('same package/version with a different artifact digest is a conflict, never a silent overwrite', async () => {
  const { service } = buildService();
  const input = release();
  await service.publishRelease(input);
  await assert.rejects(() => service.publishRelease({ ...input, artifactDigest: DIGEST_B }), { code: 'CONFLICT' });
  const stillOriginal = await service.findRelease(input.packageType + ':' + input.platform + ':' + input.version);
  assert.equal(stillOriginal.artifactDigest, DIGEST_A);
});

test('same package/version with different signing material (signature/key) is a conflict', async () => {
  const { service } = buildService();
  const input = release();
  await service.publishRelease(input);
  await assert.rejects(
    () => service.publishRelease({ ...input, signedMetadata: Buffer.from('a-different-signature-blob') }),
    { code: 'CONFLICT' },
  );
  await assert.rejects(
    () => service.publishRelease({ ...input, signingKeyId: 'a-different-signing-key' }),
    { code: 'CONFLICT' },
  );
});

test('retired package is never selected as current', async () => {
  const { service } = buildService();
  const published = await service.publishRelease(release({ version: '1.0.0' }));
  await service.retireRelease(published.releaseId);
  await assert.rejects(() => service.getCurrentRelease('ANDROID_APP', 'ANDROID'), { code: 'NOT_FOUND' });
});

test('retiring the current release falls back to the next-highest published version, not the last inserted one', async () => {
  const { service } = buildService();
  const older = await service.publishRelease(release({ version: '1.0.0', artifactDigest: DIGEST_A }));
  const newer = await service.publishRelease(release({ version: '2.0.0', artifactDigest: DIGEST_B }));
  await service.retireRelease(newer.releaseId);
  const current = await service.getCurrentRelease('ANDROID_APP', 'ANDROID');
  assert.equal(current.version, '1.0.0');
  assert.equal(current.releaseId, older.releaseId);
});

test('retiring an already-retired release is idempotent, not an error', async () => {
  const { service } = buildService();
  const published = await service.publishRelease(release());
  await service.retireRelease(published.releaseId);
  const again = await service.retireRelease(published.releaseId);
  assert.equal(again.state, 'RETIRED');
});

test('an older release published after a newer one cannot silently replace it as current', async () => {
  const { service } = buildService();
  await service.publishRelease(release({ version: '2.0.0', artifactDigest: DIGEST_A }));
  await service.publishRelease(release({ version: '1.0.0', artifactDigest: DIGEST_B }));
  const current = await service.getCurrentRelease('ANDROID_APP', 'ANDROID');
  assert.equal(current.version, '2.0.0');
});

test('1.10.0 correctly becomes current over 1.9.0 (numeric, not lexicographic, ordering)', async () => {
  const { service } = buildService();
  await service.publishRelease(release({ version: '1.9.0', artifactDigest: DIGEST_A }));
  await service.publishRelease(release({ version: '1.10.0', artifactDigest: DIGEST_B }));
  const current = await service.getCurrentRelease('ANDROID_APP', 'ANDROID');
  assert.equal(current.version, '1.10.0');
});

test('explicit rollback is distinct from ordinary publish and can move current backward', async () => {
  const { service } = buildService();
  await service.publishRelease(release({ version: '1.0.0', artifactDigest: DIGEST_A }));
  await service.publishRelease(release({ version: '2.0.0', artifactDigest: DIGEST_B }));
  let current = await service.getCurrentRelease('ANDROID_APP', 'ANDROID');
  assert.equal(current.version, '2.0.0');

  const pointer = await service.rollbackToRelease('ANDROID_APP', 'ANDROID', '1.0.0');
  assert.equal(pointer.isExplicitRollback, true);
  current = await service.getCurrentRelease('ANDROID_APP', 'ANDROID');
  assert.equal(current.version, '1.0.0');
});

test('rollback target must already exist as a published release', async () => {
  const { service } = buildService();
  await service.publishRelease(release({ version: '2.0.0' }));
  await assert.rejects(
    () => service.rollbackToRelease('ANDROID_APP', 'ANDROID', '1.0.0'),
    { code: 'ROLLBACK_TARGET_NOT_FOUND' },
  );
});

test('rollback cannot target a retired release', async () => {
  const { service } = buildService();
  const older = await service.publishRelease(release({ version: '1.0.0', artifactDigest: DIGEST_A }));
  await service.publishRelease(release({ version: '2.0.0', artifactDigest: DIGEST_B }));
  await service.retireRelease(older.releaseId);
  await assert.rejects(
    () => service.rollbackToRelease('ANDROID_APP', 'ANDROID', '1.0.0'),
    { code: 'ROLLBACK_TARGET_NOT_PUBLISHED' },
  );
});

test('ordinary publish of a newer version after an explicit rollback still advances current forward', async () => {
  const { service } = buildService();
  await service.publishRelease(release({ version: '1.0.0', artifactDigest: DIGEST_A }));
  await service.publishRelease(release({ version: '2.0.0', artifactDigest: DIGEST_B }));
  await service.rollbackToRelease('ANDROID_APP', 'ANDROID', '1.0.0');
  await service.publishRelease(release({ version: '3.0.0', artifactDigest: 'c'.repeat(64) }));
  const current = await service.getCurrentRelease('ANDROID_APP', 'ANDROID');
  assert.equal(current.version, '3.0.0');
});

test('release record contains no family-data field and rejects a family-data sentinel smuggled into signedMetadata bytes without treating it specially', async () => {
  const { service } = buildService();
  const sentinel = 'SENTINEL-family-opaque-id-should-never-appear-as-a-field';
  const record = await service.publishRelease(release({ signedMetadata: Buffer.from(sentinel) }));
  const forbiddenFields = ['familyId', 'childId', 'location', 'usage', 'policy', 'adminPin', 'enrollmentToken', 'recoverySecret', 'familyKeys'];
  for (const field of forbiddenFields) assert.equal(field in record, false);
  // the sentinel only ever exists inside the opaque signedMetadata bytes, never as structured data
  assert.equal(record.signedMetadata.toString().includes(sentinel), true);
});

test('a caller-supplied "privateKey" field is ignored -- there is no field through which a private signing key could be accepted as metadata', async () => {
  const { service } = buildService();
  const forged = release({ privateKey: 'BEGIN RSA PRIVATE KEY forged-attempt' });
  const record = await service.publishRelease(forged);
  assert.equal('privateKey' in record, false);
});

test('generic fixed errors never contain a supplied blob (digest, key id, or metadata bytes)', async () => {
  const { service } = buildService();
  const input = release({ signingKeyId: 'SENTINEL-key-id', signedMetadata: Buffer.from('SENTINEL-metadata-bytes') });
  await service.publishRelease(input);
  const error = await service.publishRelease({ ...input, artifactDigest: DIGEST_B }).catch((e) => e);
  assert.ok(error instanceof ReleaseError);
  assert.equal(error.message.includes('SENTINEL'), false);
  assert.equal(error.message.includes(DIGEST_B), false);
});

test('findRelease on an unknown id is NOT_FOUND', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.findRelease('ANDROID_APP:ANDROID:9.9.9'), { code: 'NOT_FOUND' });
});

test('minimumSupportedVersion, when present, must itself be a valid version', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.publishRelease(release({ minimumSupportedVersion: 'not-a-version' })),
    { code: 'INVALID_INPUT' },
  );
  const record = await service.publishRelease(release({ minimumSupportedVersion: '0.9.0' }));
  assert.equal(record.minimumSupportedVersion, '0.9.0');
});
