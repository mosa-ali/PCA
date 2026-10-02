// WAVE 6B-R1 — the canonical committed-submission identity
// (dist/familytrustset/FirstDeviceBootstrapCommit.js). Proves the R1-01
// properties: every component is bound (including proofSignature), the
// encoding is injective (no cross-field/LF byte-shifting; null vs '' distinct),
// the pinned exact encoding is stable, and malformed input throws (fail closed).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  BOOTSTRAP_COMMIT_DOMAIN,
  canonicalizeFirstDeviceBootstrapCommit,
  computeFirstDeviceBootstrapCommitDigest,
} from '../../dist/familytrustset/FirstDeviceBootstrapCommit.js';

const sha256 = (value) => createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');

const baseComponents = {
  proofBytes: 'PROOF',
  proofSignature: 'SIG-A',
  epoch1Bytes: 'EPOCH',
  epoch1Signature: 'SIG-B',
  attestationEvidence: 'x\ny',
};

test('the canonical committed-submission encoding is pinned and stable (R1-01)', () => {
  const canonical = canonicalizeFirstDeviceBootstrapCommit(baseComponents);
  assert.equal(
    canonical,
    '36:PCA_FIRST_DEVICE_BOOTSTRAP_COMMIT_V1' + '5:PROOF' + '5:SIG-A' + '5:EPOCH' + '5:SIG-B' + '1:1' + '3:x\ny',
  );
  assert.equal(BOOTSTRAP_COMMIT_DOMAIN.length, 36);
  const digest = computeFirstDeviceBootstrapCommitDigest(baseComponents);
  assert.equal(digest, '040b7e2c8f5d74d7be35b2fd175cdccbb67e513c9765cb266a78e01e0c818682');
  assert.equal(digest, sha256(canonical), 'the digest is sha256 over the exact canonical bytes');
  assert.equal(
    computeFirstDeviceBootstrapCommitDigest({ ...baseComponents }),
    digest,
    'deterministic for identical components',
  );
});

test("null and '' evidence have structurally distinct identities (R1-01)", () => {
  const nullEvidence = { ...baseComponents, attestationEvidence: null };
  const emptyEvidence = { ...baseComponents, attestationEvidence: '' };
  assert.equal(
    canonicalizeFirstDeviceBootstrapCommit(nullEvidence),
    '36:PCA_FIRST_DEVICE_BOOTSTRAP_COMMIT_V1' + '5:PROOF' + '5:SIG-A' + '5:EPOCH' + '5:SIG-B' + '1:0' + '0:',
  );
  assert.equal(
    canonicalizeFirstDeviceBootstrapCommit(emptyEvidence),
    '36:PCA_FIRST_DEVICE_BOOTSTRAP_COMMIT_V1' + '5:PROOF' + '5:SIG-A' + '5:EPOCH' + '5:SIG-B' + '1:1' + '0:',
  );
  const dNull = computeFirstDeviceBootstrapCommitDigest(nullEvidence);
  const dEmpty = computeFirstDeviceBootstrapCommitDigest(emptyEvidence);
  assert.equal(dNull, 'b6ca63c5340cd743ae013b4b0e5fcf9abcc17c5be7422be368af5a9ab744d3ad');
  assert.equal(dEmpty, 'a264825bcd56d616d8503cd1d0a0b9fc16aef9a5c3629d5a098d330e858d1208');
  assert.notEqual(dNull, dEmpty);
});

test('every component changes the digest: proofBytes, proofSignature, epoch1Bytes, epoch1Signature, evidence (R1-01)', () => {
  const base = computeFirstDeviceBootstrapCommitDigest(baseComponents);
  const variants = [
    { ...baseComponents, proofBytes: 'PROOFx' },
    { ...baseComponents, proofSignature: 'SIG-B' },
    { ...baseComponents, epoch1Bytes: 'EPOCH ' },
    { ...baseComponents, epoch1Signature: 'SIG-C' },
    { ...baseComponents, attestationEvidence: 'y' },
  ];
  const digests = new Set([base, ...variants.map((variant) => computeFirstDeviceBootstrapCommitDigest(variant))]);
  assert.equal(digests.size, 6, 'all six digests (base + five single-component changes) must be pairwise distinct');
});

test('LF byte-shifting across fields cannot create a canonical collision (R1-01 ambiguity pair)', () => {
  const tupleA = {
    proofBytes: 'P',
    proofSignature: 'S',
    epoch1Bytes: 'E',
    epoch1Signature: 'SIG',
    attestationEvidence: 'x\ny',
  };
  const tupleB = {
    proofBytes: 'P',
    proofSignature: 'S',
    epoch1Bytes: 'E',
    epoch1Signature: 'SIG\nx',
    attestationEvidence: 'y',
  };
  // The ORIGINAL Wave-6B construction (LF-delimited, no length framing) aliased these two
  // structurally different tuples -- prove the ambiguity vector is genuine:
  const legacyDigest = (t) =>
    sha256([t.proofBytes, t.epoch1Bytes, t.epoch1Signature, t.attestationEvidence ?? ''].join('\n'));
  assert.equal(legacyDigest(tupleA), legacyDigest(tupleB), 'the legacy construction genuinely collided');
  // The canonical construction separates them:
  assert.notEqual(
    computeFirstDeviceBootstrapCommitDigest(tupleA),
    computeFirstDeviceBootstrapCommitDigest(tupleB),
    'the canonical netstring construction must never collide on LF byte-shifting',
  );
});

test('the legacy construction omitted proofSignature; the canonical construction binds it (R1-01 omission proof)', () => {
  const legacyDigest = (t) =>
    sha256([t.proofBytes, t.epoch1Bytes, t.epoch1Signature, t.attestationEvidence ?? ''].join('\n'));
  const a = { ...baseComponents, proofSignature: 'SIG-A' };
  const b = { ...baseComponents, proofSignature: 'SIG-Z' };
  assert.equal(legacyDigest(a), legacyDigest(b), 'the legacy construction genuinely omitted proofSignature');
  assert.notEqual(computeFirstDeviceBootstrapCommitDigest(a), computeFirstDeviceBootstrapCommitDigest(b));
});

test('multibyte fields use UTF-8 byte lengths in the canonical encoding', () => {
  const components = { ...baseComponents, attestationEvidence: 'é' };
  const canonical = canonicalizeFirstDeviceBootstrapCommit(components);
  assert.ok(canonical.endsWith('1:12:é'), 'the two-byte é is prefixed with its byte length');
  assert.equal(computeFirstDeviceBootstrapCommitDigest(components), sha256(canonical));
});

test('malformed components throw (fail closed) and are never partially digested', () => {
  const cases = [
    { ...baseComponents, proofBytes: undefined },
    { ...baseComponents, proofSignature: 42 },
    { ...baseComponents, epoch1Bytes: null },
    { ...baseComponents, epoch1Signature: {} },
    { ...baseComponents, attestationEvidence: 42 },
    { ...baseComponents, attestationEvidence: undefined },
  ];
  for (const [index, components] of cases.entries()) {
    assert.throws(() => computeFirstDeviceBootstrapCommitDigest(components), TypeError, `case ${index} must throw`);
  }
});
