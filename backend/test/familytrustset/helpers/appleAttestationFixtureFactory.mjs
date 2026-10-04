// Wave 6D test helper: builds fully real Apple-App-Attest-STYLE fixtures --
// real P-256 ECDSA certificate chains (root -> [intermediate] -> credCert),
// real credCert nonce extension OID 1.2.840.113635.100.8.2 with the exact
// Apple inner structure, real COSE-key bytes inside authData, real CBOR
// attestation/assertion objects (canonical definite-length encodings), and
// the exact evidence JSON envelope the Swift client produces (sorted keys).
// Test-only material; keys are generated fresh per call and never stored.
import { createHash, createSign, X509Certificate } from 'node:crypto';
import {
  der,
  derBoolean,
  derBitString,
  derInt,
  derOctetString,
  derSeq,
  derSet,
  derUtf8,
  derUtcTime,
  generateP256KeyPair,
} from './x509FixtureFactory.mjs';

const OID_CN = Buffer.from('550403', 'hex');
const OID_ECDSA_WITH_SHA256 = Buffer.from('2a8648ce3d040302', 'hex');
const OID_BASIC_CONSTRAINTS = Buffer.from('551d13', 'hex');
export const OID_APPATTEST_NONCE = Buffer.from('2a864886f763640802', 'hex'); // 1.2.840.113635.100.8.2

export const APP_ATTEST_PRODUCTION_AAGUID = Buffer.from('61707061747465737400000000000000', 'hex');
export const APP_ATTEST_DEVELOPMENT_AAGUID = Buffer.from('617070617474657374646576656c6f70', 'hex');

const sha256 = (data) => createHash('sha256').update(data).digest();

// ---------- minimal canonical CBOR writer ----------

function cborHead(major, value) {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value <= 0xff) return Buffer.from([(major << 5) | 24, value]);
  if (value <= 0xffff) {
    const out = Buffer.alloc(3);
    out[0] = (major << 5) | 25;
    out.writeUInt16BE(value, 1);
    return out;
  }
  const out = Buffer.alloc(5);
  out[0] = (major << 5) | 26;
  out.writeUInt32BE(value, 1);
  return out;
}

export const cborBytes = (buffer) => Buffer.concat([cborHead(2, buffer.length), Buffer.from(buffer)]);
export const cborText = (text) => {
  const bytes = Buffer.from(text, 'utf8');
  return Buffer.concat([cborHead(3, bytes.length), bytes]);
};
export const cborArray = (items) => Buffer.concat([cborHead(4, items.length), ...items]);
export const cborMap = (entries) => Buffer.concat([cborHead(5, entries.length), ...entries.flat()]);

// ---------- certificate construction ----------

function spkiDer(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' });
}

function nonceExtensionValue(nonce) {
  // SEQUENCE { [1] EXPLICIT { OCTET STRING (32) } } -- Apple's shape.
  return derSeq(der(0xa1, derOctetString(nonce)));
}

function buildSpecialCertificate(options) {
  const extensions = [
    derSeq(oid(OID_BASIC_CONSTRAINTS), derOctetString(options.isCa ? derSeq(derBoolean(true)) : derSeq())),
  ];
  if (options.nonce !== null && options.nonce !== undefined) {
    extensions.push(derSeq(oid(OID_APPATTEST_NONCE), derOctetString(nonceExtensionValue(options.nonce))));
    if (options.duplicateNonce) {
      extensions.push(derSeq(oid(OID_APPATTEST_NONCE), derOctetString(nonceExtensionValue(options.nonce))));
    }
  }
  const tbs = derSeq(
    der(0xa0, derInt(2)),
    derInt(options.serial),
    derSeq(oid(OID_ECDSA_WITH_SHA256)),
    derSeq(derSet(derSeq(oid(OID_CN), derUtf8(options.issuerCommonName)))),
    derSeq(derUtcTime(options.notBefore), derUtcTime(options.notAfter)),
    derSeq(derSet(derSeq(oid(OID_CN), derUtf8(options.subjectCommonName)))),
    spkiDer(options.subjectPublicKey),
    der(0xa3, derSeq(...extensions)),
  );
  const signer = createSign('SHA256');
  signer.update(tbs);
  let signature = signer.sign(options.issuerPrivateKey);
  if (options.corruptSignature) {
    signature = Buffer.from(signature);
    signature[signature.length - 1] ^= 0xff;
  }
  return derSeq(tbs, derSeq(oid(OID_ECDSA_WITH_SHA256)), derBitString(signature));
}

function oid(content) {
  return der(0x06, content);
}

const pointFromKeypair = (keyPair) => {
  const jwk = keyPair.publicKey.export({ format: 'jwk' });
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
};

const coseKeyForPoint = (point, middleOverride) => Buffer.concat([
  Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
  point.subarray(1, 33),
  middleOverride ?? Buffer.from([0x22, 0x58, 0x20]),
  point.subarray(33, 65),
]);

/**
 * Builds one complete, VALID fixture and returns every intermediate so the
 * kill-matrix test can mutate exactly one aspect at a time.
 */
export function buildAppleAppAttestFixture(options = {}) {
  const {
    appId = 'ABCDE12345.com.pca.app',
    environment = 'production',
    dskKeyId = '55555555-5555-4555-8555-555555555555',
    familyId = '11111111-1111-4111-8111-111111111111',
    deviceId = '22222222-2222-4222-8222-222222222222',
    ceremonyId = '33333333-3333-4333-8333-333333333333',
    challengeId = '44444444-4444-4444-8444-444444444444',
    nonce = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    includeIntermediate = false,
    now = new Date('2026-10-04T00:00:00.000Z'),
    issuedAt = new Date('2026-10-03T00:00:00.000Z'),
    serial = 0x6d,
  } = options;

  const rootKeyPair = generateP256KeyPair();
  const intermediateKeyPair = generateP256KeyPair();
  const credKeyPair = generateP256KeyPair();
  const credPoint = pointFromKeypair(credKeyPair);
  // The DSK is the SEPARATE Secure Enclave key (App Attest key != DSK by
  // construction); the fixture therefore defaults them to DIFFERENT keys,
  // and the DSK is bound only through clientDataHash_1 + the transcript.
  const dskPoint = options.dskKeyPair ? pointFromKeypair(options.dskKeyPair) : pointFromKeypair(generateP256KeyPair());
  const dskPublicKey = options.dskPublicKeyOverride ?? dskPoint.toString('base64url');
  const expectedDskPublicKey = options.expectedDskPublicKeyOverride ?? dskPublicKey;

  const fullTranscript = options.transcriptOverride
    ?? [
      'PCA_IOS_DSK_ATTESTATION_V1',
      '1',
      familyId,
      deviceId,
      ceremonyId,
      challengeId,
      nonce,
      'ECDSA_P256_SHA256',
      dskKeyId,
      dskPublicKey,
    ].map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('');

  const appIdHash = sha256(Buffer.from(appId, 'utf8'));
  const keyIdBytes = sha256(credPoint);
  const aaguid = options.aaguidOverride
    ?? (environment === 'production' ? APP_ATTEST_PRODUCTION_AAGUID : APP_ATTEST_DEVELOPMENT_AAGUID);
  // Credential key INSIDE authData (COSE); optionally a divergent key to
  // kill the credId/COSE cross-check.
  const cosePoint = options.coseKeyPointOverride ?? credPoint;

  const clientData1 = options.attestationClientDataOverride
    ?? `PCA_IOS_APPATTEST_ATTESTATION_V1|${dskKeyId}|${dskPublicKey}`;
  const credId = options.credIdOverride ?? keyIdBytes;

  const authData1 = Buffer.concat([
    options.attestationRpIdHashOverride ?? appIdHash,
    Buffer.from([0x01]),
    options.attestationCounterOverride ?? Buffer.from([0x00, 0x00, 0x00, 0x00]),
    aaguid,
    options.credIdLengthOverride ?? Buffer.from([0x00, 0x20]),
    credId,
    coseKeyForPoint(cosePoint, options.coseKeyMiddleOverride),
    options.authDataExtensions ?? Buffer.alloc(0),
  ]);

  const nonce1 = options.attestationNonceOverride
    ?? sha256(Buffer.concat([authData1, sha256(Buffer.from(clientData1, 'utf8'))]));

  const credCert = buildSpecialCertificate({
    serial,
    issuerCommonName: includeIntermediate ? 'PCA Wave 6D Fixture Intermediate' : 'PCA Wave 6D Fixture Root',
    subjectCommonName: 'PCA Wave 6D Fixture CredCert',
    subjectPublicKey: credKeyPair.publicKey,
    // mislinkCredCert: issuer NAME says Intermediate but the signature is
    // made by the root -- the adjacent-link signature check must refuse it.
    issuerPrivateKey: includeIntermediate && !options.mislinkCredCert
      ? intermediateKeyPair.privateKey
      : rootKeyPair.privateKey,
    notBefore: issuedAt,
    notAfter: new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000),
    isCa: false,
    nonce: options.omitNonceExtension ? null : nonce1,
    duplicateNonce: options.duplicateNonceExtension ?? false,
    corruptSignature: options.corruptCredCertSignature ?? false,
  });

  const rootCertificate = buildSpecialCertificate({
    serial: 0x01,
    issuerCommonName: 'PCA Wave 6D Fixture Root',
    subjectCommonName: 'PCA Wave 6D Fixture Root',
    subjectPublicKey: rootKeyPair.publicKey,
    issuerPrivateKey: rootKeyPair.privateKey,
    notBefore: issuedAt,
    notAfter: new Date(issuedAt.getTime() + 365 * 24 * 60 * 60 * 1000),
    isCa: true,
    nonce: null,
  });

  const chain = [credCert];
  if (includeIntermediate) {
    const intermediate = buildSpecialCertificate({
      serial: 0x02,
      issuerCommonName: 'PCA Wave 6D Fixture Root',
      subjectCommonName: 'PCA Wave 6D Fixture Intermediate',
      subjectPublicKey: intermediateKeyPair.publicKey,
      issuerPrivateKey: rootKeyPair.privateKey,
      notBefore: issuedAt,
      notAfter: new Date(issuedAt.getTime() + 180 * 24 * 60 * 60 * 1000),
      isCa: true,
      nonce: null,
      corruptSignature: options.corruptIntermediateSignature ?? false,
    });
    chain.push(intermediate);
  }

  // Assertion over the WebAuthn/App-Attest signing input
  // `authenticatorData_2 || clientDataHash_2` (ECDSA over its SHA-256
  // digest). `signDoubleHashedNonce` reproduces the historical wrong
  // equation (hash applied to the pre-hashed nonce again) so the kill
  // matrix can prove it is NOT accepted.
  const assertionAuthData = Buffer.concat([
    options.assertionRpIdHashOverride ?? appIdHash,
    Buffer.from([0x01]),
    options.assertionCounterOverride ?? Buffer.from([0x00, 0x00, 0x00, 0x01]),
  ]);
  const assertionSigningInput = Buffer.concat([assertionAuthData, sha256(Buffer.from(fullTranscript, 'utf8'))]);
  const assertionSigner = createSign('SHA256');
  assertionSigner.update(options.signDoubleHashedNonce ? sha256(assertionSigningInput) : assertionSigningInput);
  let assertionSignature = assertionSigner.sign(credKeyPair.privateKey);
  if (options.corruptAssertionSignature) {
    assertionSignature = Buffer.from(assertionSignature);
    assertionSignature[assertionSignature.length - 1] ^= 0xff;
  }

  const attestationCbor = options.attestationCborOverride ?? cborMap([
    [cborText('fmt'), cborText(options.fmtOverride ?? 'apple-appattest')],
    [cborText('attStmt'), cborMap([
      [cborText('x5c'), cborArray((options.x5cOverride ?? chain).map(cborBytes))],
      [cborText('receipt'), cborBytes(options.receiptOverride ?? Buffer.from('fixture-receipt', 'utf8'))],
    ])],
    [cborText('authData'), cborBytes(authData1)],
  ]);

  const assertionCbor = options.assertionCborOverride ?? cborMap([
    [cborText('signature'), cborBytes(assertionSignature)],
    [cborText('authenticatorData'), cborBytes(assertionAuthData)],
  ]);

  const envelope = {
    assertion: assertionCbor.toString('base64url'),
    attestation: attestationCbor.toString('base64url'),
    keyId: (options.envelopeKeyIdOverride ?? keyIdBytes).toString('base64url'),
    platform: options.envelopePlatformOverride ?? 'IOS',
    transcript: fullTranscript,
    v: options.envelopeVersionOverride ?? 1,
  };
  const envelopeJson = options.envelopeRawOverride ?? JSON.stringify(envelope);

  return {
    appId,
    environment,
    evidence: envelopeJson,
    envelope,
    transcript: fullTranscript,
    expectedDskKeyId: dskKeyId,
    expectedDskPublicKey,
    expectedDskAlgorithm: 'ECDSA_P256_SHA256',
    keyIdBytes,
    credPoint,
    credCertDer: credCert,
    dskPublicKey,
    rootCertificate,
    rootCertificates: [new X509Certificate(rootCertificate)],
    rootDer: [Buffer.from(rootCertificate)],
    rootPem: `-----BEGIN CERTIFICATE-----\n${rootCertificate.toString('base64').replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END CERTIFICATE-----\n`,
    inputs: {
      familyId,
      deviceId,
      ceremonyId,
      challengeId,
      nonce,
      platform: 'IOS',
      attestationEvidence: envelopeJson,
      expectedDskKeyId: dskKeyId,
      expectedDskPublicKey,
      expectedDskAlgorithm: 'ECDSA_P256_SHA256',
      now,
    },
  };
}

/** Convenience: verifier input object from a fixture, with overrides. */
export function verificationInput(fixture, overrides = {}) {
  return { ...fixture.inputs, ...overrides };
}
