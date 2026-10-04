// Wave 6D adversarial kill matrix for AppleAppAttestVerifier + the strict
// CBOR reader. Every fixture chain, CBOR object, COSE key and evidence
// envelope is built with REAL bytes (no scrubbed doubles); each REJECTED
// case mutates exactly ONE aspect of a fixture that VERIFIES as-is, so a
// regression that stops checking that aspect is caught behaviorally.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AppleAppAttestVerifier } from '../../dist/familytrustset/AppleAppAttestVerifier.js';
import { decodeStrictCbor } from '../../dist/familytrustset/AppleAppAttestCbor.js';
import { parsePemCertificateBundle } from '../../dist/familytrustset/PlatformAttestationVerifier.js';
import {
  buildAppleAppAttestFixture,
  cborBytes,
  cborMap,
  cborText,
  verificationInput,
} from './helpers/appleAttestationFixtureFactory.mjs';

const sha256Hex = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

function verifierFor(fixture, overrides = {}) {
  const parsed = parsePemCertificateBundle(fixture.rootPem);
  assert.ok(parsed, 'fixture root PEM must parse');
  return new AppleAppAttestVerifier({
    rootCertificates: overrides.rootCertificates ?? parsed.certificates,
    rootDer: overrides.rootDer ?? parsed.der,
    appId: overrides.appId ?? fixture.appId,
    environment: overrides.environment ?? fixture.environment,
  });
}

async function verdictFor(fixture, inputOverrides = {}, verifierOverrides = {}) {
  return verifierFor(fixture, verifierOverrides).verifyFirstDeviceAttestation(
    verificationInput(fixture, inputOverrides),
  );
}

test('VERIFIED baseline: real chain + real CBOR + exact transcript; the DSK is a genuinely different key from the App Attest key', async () => {
  const fixture = buildAppleAppAttestFixture();
  const verdict = await verdictFor(fixture);
  assert.equal(verdict.status, 'VERIFIED');
  assert.equal(verdict.attestedDskKeyId, fixture.expectedDskKeyId);
  assert.equal(verdict.attestedDskPublicKey, fixture.expectedDskPublicKey);
  assert.equal(verdict.attestedDskAlgorithm, 'ECDSA_P256_SHA256');
  assert.equal(verdict.evidenceDigest, sha256Hex(fixture.evidence));
  // Architecture separation: the attested DSK public key is NOT the App
  // Attest credential key; the binding runs through clientDataHash_1 + the
  // assertion transcript only.
  assert.notEqual(fixture.dskPublicKey, fixture.credPoint.toString('base64url'));
  // Envelope shape parity with the Swift adapter (sorted keys, unpadded b64url).
  assert.ok(fixture.evidence.startsWith('{"assertion":"'));
  assert.deepEqual(
    Object.keys(JSON.parse(fixture.evidence)),
    ['assertion', 'attestation', 'keyId', 'platform', 'transcript', 'v'],
  );
  assert.ok(!fixture.evidence.includes('='));
});

test('VERIFIED: a two-certificate chain (credCert + intermediate) anchored to the pinned root', async () => {
  const fixture = buildAppleAppAttestFixture({ includeIntermediate: true });
  const verdict = await verdictFor(fixture);
  assert.equal(verdict.status, 'VERIFIED');
});

test('development environment: matching aaguid verifies; production evidence against a development verifier rejects', async () => {
  const devFixture = buildAppleAppAttestFixture({ environment: 'development' });
  const devVerdict = await verdictFor(devFixture, {}, { environment: 'development' });
  assert.equal(devVerdict.status, 'VERIFIED');
  const mismatch = await verdictFor(devFixture, {}, { environment: 'production' });
  assert.deepEqual(mismatch, { status: 'REJECTED', reason: 'aaguid_mismatch' });
});

test('REJECTED matrix: every single-aspect mutation of a VERIFIED fixture is refused with a bounded reason', async () => {
  const cases = [];

  // Transcript is the hinge: valid canonical transcript but for a different
  // ceremony nonce, with the assertion honestly signing THAT transcript.
  const otherNonce = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  {
    const base = buildAppleAppAttestFixture();
    const tampered = [
      ['PCA_IOS_DSK_ATTESTATION_V1', '1', base.inputs.familyId, base.inputs.deviceId, base.inputs.ceremonyId, base.inputs.challengeId, otherNonce, 'ECDSA_P256_SHA256', base.expectedDskKeyId, base.dskPublicKey],
    ].map((fields) => fields.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('')).join('');
    const fixture = buildAppleAppAttestFixture({ transcriptOverride: tampered });
    cases.push(['transcript_mismatch (nonce)', fixture, {}, {}, 'transcript_mismatch']);
  }
  {
    const base = buildAppleAppAttestFixture();
    const otherKeyId = '99999999-9999-4999-8999-999999999999';
    const tampered = [base.inputs.familyId, base.inputs.deviceId, base.inputs.ceremonyId, base.inputs.challengeId, base.inputs.nonce, 'ECDSA_P256_SHA256', otherKeyId, base.dskPublicKey];
    const transcript = [['PCA_IOS_DSK_ATTESTATION_V1', '1', ...tampered]]
      .map((fields) => fields.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('')).join('');
    const fixture = buildAppleAppAttestFixture({ transcriptOverride: transcript });
    cases.push(['transcript_mismatch (dskKeyId)', fixture, {}, {}, 'transcript_mismatch']);
  }

  // attestation clientDataHash must be the ENROLLMENT-STABLE derivation:
  // attesting over any other clientData string can never verify.
  {
    const fixture = buildAppleAppAttestFixture({
      attestationClientDataOverride: 'PCA_IOS_APPATTEST_ATTESTATION_V1|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|wrong',
    });
    cases.push(['attestation_nonce_mismatch (weak clientData)', fixture, {}, {}, 'attestation_nonce_mismatch']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ omitNonceExtension: true });
    cases.push(['attestation_nonce_mismatch (extension removed)', fixture, {}, {}, 'attestation_nonce_mismatch']);
  }
  {
    const fixture = buildAppleAppAttestFixture({
      attestationNonceOverride: Buffer.alloc(32, 0x77),
    });
    cases.push(['attestation_nonce_mismatch (wrong nonce)', fixture, {}, {}, 'attestation_nonce_mismatch']);
  }

  {
    const fixture = buildAppleAppAttestFixture({ corruptAssertionSignature: true });
    cases.push(['assertion_signature_invalid', fixture, {}, {}, 'assertion_signature_invalid']);
  }
  {
    // Equation discrimination: a signature over the DOUBLE-HASHED nonce
    // (the historical wrong equation) must NEVER verify.
    const fixture = buildAppleAppAttestFixture({ signDoubleHashedNonce: true });
    cases.push(['assertion_signature_invalid (double-hashed nonce)', fixture, {}, {}, 'assertion_signature_invalid']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ assertionRpIdHashOverride: Buffer.alloc(32, 0x11) });
    cases.push(['assertion_rp_id_mismatch', fixture, {}, {}, 'assertion_rp_id_mismatch']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ assertionCounterOverride: Buffer.from([0, 0, 0, 0]) });
    cases.push(['assertion_counter_invalid', fixture, {}, {}, 'assertion_counter_invalid']);
  }
  {
    // QA gap batch: layout, bounds and rebuild-path coverage.
    const fixture = buildAppleAppAttestFixture({ attestationRpIdHashOverride: Buffer.alloc(32, 0x44) });
    cases.push(['attestation_rp_id_mismatch', fixture, {}, {}, 'attestation_rp_id_mismatch']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ credIdLengthOverride: Buffer.from([0x00, 0x10]) });
    cases.push(['attestation_malformed (credIdLen)', fixture, {}, {}, 'attestation_malformed']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ coseKeyMiddleOverride: Buffer.from([0x23, 0x58, 0x20]) });
    cases.push(['attestation_malformed (COSE middle)', fixture, {}, {}, 'attestation_malformed']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ attestationCounterOverride: Buffer.from([0xff, 0xff, 0xff, 0xff]) });
    cases.push(['attestation_counter_nonzero (0xFFFFFFFF)', fixture, {}, {}, 'attestation_counter_nonzero']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ envelopeKeyIdOverride: Buffer.alloc(31, 0x55) });
    cases.push(['evidence_malformed (keyId 31 bytes)', fixture, {}, {}, 'evidence_malformed']);
  }
  {
    const base = buildAppleAppAttestFixture();
    const longTranscript = 'x'.repeat(2_500);
    const raw = JSON.stringify({ ...base.envelope, transcript: longTranscript });
    const fixture = buildAppleAppAttestFixture({ envelopeRawOverride: raw });
    cases.push(['evidence_malformed (transcript >2048)', fixture, {}, {}, 'evidence_malformed']);
  }
  {
    const base = buildAppleAppAttestFixture();
    const fixture = buildAppleAppAttestFixture({ x5cOverride: [base.credCertDer, base.credCertDer, base.credCertDer, base.credCertDer] });
    cases.push(['attestation_malformed (chain >3)', fixture, {}, {}, 'attestation_malformed']);
  }
  {
    // Assertion authenticatorData must be exactly 37 bytes.
    const shortAuthData = Buffer.alloc(36, 0x01);
    const raw = cborMap([
      [cborText('signature'), cborBytes(Buffer.from([0x30, 0x00]))],
      [cborText('authenticatorData'), cborBytes(shortAuthData)],
    ]);
    const fixture = buildAppleAppAttestFixture({ assertionCborOverride: raw });
    cases.push(['assertion_malformed (authData len)', fixture, {}, {}, 'assertion_malformed']);
  }
  {
    // expected-vs-evidence re-pin: a DIFFERENT expected DSK can never match
    // the server-side transcript rebuild.
    const base = buildAppleAppAttestFixture();
    const other = buildAppleAppAttestFixture();
    cases.push([
      'transcript_mismatch (other expected DSK)',
      base,
      { expectedDskPublicKey: other.dskPublicKey },
      {},
      'transcript_mismatch',
    ]);
  }
  {
    const fixture = buildAppleAppAttestFixture({ attestationCounterOverride: Buffer.from([0, 0, 0, 1]) });
    cases.push(['attestation_counter_nonzero', fixture, {}, {}, 'attestation_counter_nonzero']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ aaguidOverride: Buffer.from('com.examplebogus', 'utf8') });
    cases.push(['aaguid_mismatch (bogus)', fixture, {}, {}, 'aaguid_mismatch']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ envelopeKeyIdOverride: Buffer.alloc(32, 0x22) });
    cases.push(['key_id_mismatch (envelope)', fixture, {}, {}, 'key_id_mismatch']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ credIdOverride: Buffer.alloc(32, 0x33) });
    cases.push(['key_id_mismatch (credId)', fixture, {}, {}, 'key_id_mismatch']);
  }
  {
    const replacement = buildAppleAppAttestFixture();
    const fixture = buildAppleAppAttestFixture({ coseKeyPointOverride: replacement.credPoint });
    cases.push(['attestation_key_mismatch (COSE)', fixture, {}, {}, 'attestation_key_mismatch']);
  }

  // Chain attacks: a trailing byte appended to the credCert DER must die on
  // the raw-DER byte-identity guard (node's X.509 parser tolerates it). The
  // verifier is rooted at the BASE fixture's root so that, with the guard
  // removed, every later step would otherwise VERIFY -- only the byte-
  // identity guard can produce this rejection.
  {
    const base = buildAppleAppAttestFixture();
    const parsedBase = parsePemCertificateBundle(base.rootPem);
    const extended = Buffer.concat([base.credCertDer, Buffer.from([0x00])]);
    const fixture = buildAppleAppAttestFixture({ x5cOverride: [extended] });
    cases.push([
      'certificate_chain_invalid (trailing byte)',
      fixture,
      {},
      { rootCertificates: parsedBase.certificates, rootDer: parsedBase.der },
      'certificate_chain_invalid',
    ]);
  }
  {
    const fixture = buildAppleAppAttestFixture({ mislinkCredCert: true, includeIntermediate: true });
    cases.push(['certificate_chain_invalid (mis-linked credCert)', fixture, {}, {}, 'certificate_chain_invalid']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ corruptIntermediateSignature: true, includeIntermediate: true });
    cases.push(['trust_anchor_missing (broken intermediate signature)', fixture, {}, {}, 'trust_anchor_missing']);
  }
  {
    const foreign = buildAppleAppAttestFixture();
    const parsedForeign = parsePemCertificateBundle(foreign.rootPem);
    const fixture = buildAppleAppAttestFixture();
    cases.push([
      'trust_anchor_missing (unpinned root)',
      fixture,
      {},
      { rootCertificates: parsedForeign.certificates, rootDer: parsedForeign.der },
      'trust_anchor_missing',
    ]);
  }
  {
    const fixture = buildAppleAppAttestFixture({
      issuedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    cases.push(['certificate_expired', fixture, {}, {}, 'certificate_expired']);
  }

  // Envelope / CBOR / routing strictness.
  {
    const fixture = buildAppleAppAttestFixture({ envelopePlatformOverride: 'ANDROID' });
    cases.push(['evidence_malformed (platform)', fixture, {}, {}, 'evidence_malformed']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ envelopeVersionOverride: 2 });
    cases.push(['evidence_malformed (v)', fixture, {}, {}, 'evidence_malformed']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ receiptOverride: Buffer.alloc(0) });
    cases.push(['attestation_malformed (receipt)', fixture, {}, {}, 'attestation_malformed']);
  }
  {
    const fixture = buildAppleAppAttestFixture({ fmtOverride: 'apple-appattest-2' });
    cases.push(['attestation_fmt_mismatch', fixture, {}, {}, 'attestation_fmt_mismatch']);
  }
  {
    const fixture = buildAppleAppAttestFixture();
    const duplicated = Buffer.concat([
      Buffer.from([0xa2]),
      cborText('signature'),
      Buffer.from([0x58, 0x02, 0xde, 0xad]),
      cborText('signature'),
      Buffer.from([0x58, 0x02, 0xde, 0xad]),
    ]);
    const tampered = buildAppleAppAttestFixture({ assertionCborOverride: duplicated });
    cases.push(['assertion_malformed (duplicate key)', tampered, {}, {}, 'assertion_malformed']);
  }
  {
    // Trailing byte after a complete CBOR map.
    const base = buildAppleAppAttestFixture();
    const raw = Buffer.from(base.envelope.assertion, 'base64url');
    const tampered = buildAppleAppAttestFixture({ assertionCborOverride: Buffer.concat([raw, Buffer.from([0x00])]) });
    cases.push(['assertion_malformed (trailing CBOR byte)', tampered, {}, {}, 'assertion_malformed']);
  }
  {
    // No aaguid environment negotiation: production verifier + prod aaguid is
    // covered above; here: attestation without the fixed 164-byte layout.
    const fixture = buildAppleAppAttestFixture({ authDataExtensions: Buffer.from([0xff, 0xff]) });
    cases.push(['attestation_malformed (bad trailing extension)', fixture, {}, {}, 'attestation_malformed']);
  }

  for (const [name, fixture, inputOverrides, verifierOverrides, expectedReason] of cases) {
    const verdict = await verdictFor(fixture, inputOverrides, verifierOverrides);
    assert.deepEqual(verdict, { status: 'REJECTED', reason: expectedReason }, name);
  }
});

test('non-evidence rejections: platform mismatch, algorithm, missing/oversized evidence, unconfigured app id', async () => {
  const fixture = buildAppleAppAttestFixture();
  assert.deepEqual(await verdictFor(fixture, { platform: 'ANDROID' }), { status: 'REJECTED', reason: 'platform_mismatch' });
  assert.deepEqual(await verdictFor(fixture, { expectedDskAlgorithm: 'RSA_SHA256' }), { status: 'REJECTED', reason: 'dsk_algorithm_unsupported' });
  assert.deepEqual(await verdictFor(fixture, { attestationEvidence: null }), { status: 'REJECTED', reason: 'evidence_missing' });
  assert.deepEqual(await verdictFor(fixture, { attestationEvidence: '' }), { status: 'REJECTED', reason: 'evidence_missing' });
  assert.deepEqual(
    await verdictFor(fixture, { attestationEvidence: ' '.repeat(17_000) }),
    { status: 'REJECTED', reason: 'evidence_too_large' },
  );
  assert.deepEqual(await verdictFor(fixture, {}, { appId: 'not-a-team-id' }), { status: 'REJECTED', reason: 'app_id_not_configured' });
  // Unpinned trusts: an empty root set can never anchor anything.
  assert.deepEqual(await verdictFor(fixture, {}, { rootCertificates: [], rootDer: [] }), { status: 'REJECTED', reason: 'trust_anchor_missing' });
});

test('strict CBOR reader: canonical accepts, every deviation rejects (never throws)', () => {
  // Canonical small map {a: 1} => 0xa1 0x61 0x61 0x01
  assert.deepEqual(decodeStrictCbor(Buffer.from([0xa1, 0x61, 0x61, 0x01])), { a: 1 });
  assert.deepEqual(decodeStrictCbor(Buffer.from([0x82, 0x01, 0xf4])), [1, false]);
  const rejects = [
    ['empty', Buffer.alloc(0)],
    ['trailing byte', Buffer.from([0xa1, 0x61, 0x61, 0x01, 0x00])],
    ['non-minimal uint', Buffer.from([0x18, 0x05])],
    ['non-minimal length', Buffer.from([0x58, 0x01, 0xaa])],
    ['indefinite bytes', Buffer.from([0x5f, 0x41, 0xaa, 0xff])],
    ['indefinite map', Buffer.from([0xbf, 0xff])],
    ['tag', Buffer.from([0xc0, 0x01])],
    ['float', Buffer.from([0xfb, 0x3f, 0xf1, 0x99, 0x99, 0x99, 0x99, 0x99, 0x9a])],
    ['undefined', Buffer.from([0xf7])],
    ['negative int', Buffer.from([0x20])],
    ['invalid utf8 text', Buffer.from([0x61, 0xff])],
    ['duplicate keys', Buffer.from([0xa2, 0x61, 0x61, 0x01, 0x61, 0x61, 0x02])],
    ['non-string key', Buffer.from([0xa1, 0x01, 0x01])],
    ['truncated', Buffer.from([0x58, 0x20, 0x00])],
  ];
  for (const [name, input] of rejects) {
    assert.equal(decodeStrictCbor(input), null, name);
  }
});
