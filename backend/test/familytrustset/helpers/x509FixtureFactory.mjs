// Wave 6C test helper: a small, pure-node X.509 certificate factory used ONLY
// by tests to produce fully real DER certificate chains (real ECDSA
// signatures, real TBSCertificate structure, real KeyDescription extension
// bytes) for AndroidKeyAttestationVerifier and PlatformAttestationVerifier
// fixtures. No external tool (openssl), no committed binary fixtures, no new
// dependencies: node:crypto generates keys and signs TBS bytes, and the
// minimal DER writer below emits the exact structures an Android Key
// Attestation chain uses. Test-only material; keys are generated fresh per
// call (never stored, never secret, never production).
import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';

// ---------- minimal DER writer ----------

function derLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function der(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), Buffer.from(content)]);
}

export function derSeq(...parts) {
  return der(0x30, Buffer.concat(parts));
}

export function derSet(...parts) {
  return der(0x31, Buffer.concat(parts));
}

export function derExplicit(tagNumber, content) {
  let tagBytes;
  if (tagNumber < 31) tagBytes = [0xa0 | tagNumber];
  else {
    const numberBytes = [tagNumber & 0x7f];
    let remaining = Math.floor(tagNumber / 128);
    while (remaining > 0) {
      numberBytes.unshift(0x80 | (remaining & 0x7f));
      remaining = Math.floor(remaining / 128);
    }
    tagBytes = [0xbf, ...numberBytes];
  }
  return Buffer.concat([Buffer.from(tagBytes), derLength(content.length), content]);
}

export function derInt(value) {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  let bytes = Buffer.from(hex, 'hex');
  if (bytes.length === 0) bytes = Buffer.from([0]);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return der(0x02, bytes);
}

export function derEnum(value) {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  return der(0x0a, Buffer.from(hex, 'hex'));
}

export function derOctetString(content) {
  return der(0x04, content);
}

export function derBitString(content, unusedBits = 0) {
  return der(0x03, Buffer.concat([Buffer.from([unusedBits]), content]));
}

export function derUtf8(value) {
  return der(0x0c, Buffer.from(value, 'utf8'));
}

export function derBoolean(value) {
  return der(0x01, Buffer.from([value ? 0xff : 0x00]));
}

/** UTCTime (YYMMDDHHMMSSZ) for years 1950..2049 -- all fixture dates live there. */
export function derUtcTime(date) {
  const iso = date.toISOString(); // 2026-10-02T00:00:00.000Z
  const text = `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return der(0x17, Buffer.from(text, 'ascii'));
}

// OIDs used by the fixtures (raw content bytes, no 06/len wrapper).
const OID_CN = Buffer.from('550403', 'hex'); // 2.5.4.3
const OID_ECDSA_WITH_SHA256 = Buffer.from('2a8648ce3d040302', 'hex'); // 1.2.840.10045.4.3.2
const OID_BASIC_CONSTRAINTS = Buffer.from('551d13', 'hex'); // 2.5.29.19
export const OID_KEY_DESCRIPTION = Buffer.from('2b06010401d679020111', 'hex'); // 1.3.6.1.4.1.11129.2.1.17

function oid(content) {
  return der(0x06, content);
}

// Name ::= CHOICE { rdnSequence RDNSequence } where RDNSequence is a
// SEQUENCE OF SET OF AttributeTypeAndValue -- the outer SEQUENCE is
// mandatory and its absence is exactly the "wrong tag" OpenSSL reports.
function rdnCommonName(commonName) {
  return derSeq(derSet(derSeq(oid(OID_CN), derUtf8(commonName))));
}

function algorithmIdentifier() {
  return derSeq(oid(OID_ECDSA_WITH_SHA256));
}

// ---------- KeyDescription construction ----------

/**
 * Builds KeyDescription DER exactly per the platform schema:
 * SEQUENCE { INT version, ENUM attestationSecurityLevel, INT keymasterVersion,
 *            ENUM keymasterSecurityLevel, OCTET STRING challenge,
 *            OCTET STRING uniqueId, SEQUENCE softwareEnforced, SEQUENCE teeEnforced }
 * AuthorizationList entries follow the AOSP EXPLICIT context-tag schema.
 */
export function buildKeyDescription({
  attestationVersion = 3,
  securityLevel = 1,
  keymasterVersion = 4,
  keymasterSecurityLevel = 1,
  challenge = Buffer.from('challenge', 'utf8'),
  uniqueId = Buffer.alloc(0),
  tee = { purpose: [2], algorithm: 3, origin: 0, digest: [4], curve: 1 },
  software = { purpose: [], algorithm: null, origin: null, digest: [], curve: null },
  omitTee = false,
  includeUnknownTeeEntry = false,
} = {}) {
  const authList = (entries, config) => {
    const parts = [];
    if (config.purpose && config.purpose.length > 0) {
      parts.push(derExplicit(1, derSet(...config.purpose.map((value) => derInt(value)))));
    }
    if (config.algorithm !== null && config.algorithm !== undefined) {
      parts.push(derExplicit(2, derInt(config.algorithm)));
    }
    if (includeUnknownTeeEntry) {
      // Unknown but validly encoded entry (keySize tag [3], INTEGER 256):
      // the parser must skip it strictly and keep going.
      parts.push(derExplicit(3, derInt(256)));
    }
    if (config.digest && config.digest.length > 0) {
      parts.push(derExplicit(5, derSet(...config.digest.map((value) => derInt(value)))));
    }
    if (config.curve !== null && config.curve !== undefined) {
      parts.push(derExplicit(10, derInt(config.curve)));
    }
    if (config.origin !== null && config.origin !== undefined) {
      parts.push(derExplicit(702, derInt(config.origin)));
    }
    return Buffer.concat(parts);
  };
  const softwareEnforced = derSeq(authList('software', software));
  const teeEnforced = omitTee ? derSeq() : derSeq(authList('tee', tee));
  return derSeq(
    derInt(attestationVersion),
    derEnum(securityLevel),
    derInt(keymasterVersion),
    derEnum(keymasterSecurityLevel),
    derOctetString(challenge),
    derOctetString(uniqueId),
    softwareEnforced,
    teeEnforced,
  );
}

// ---------- certificate construction ----------

function buildCertificate({
  subjectCommonName,
  issuerCommonName,
  subjectPublicKeyDer,
  issuerPrivateKey,
  serial,
  notBefore,
  notAfter,
  isCa,
  keyDescription,
  omitKeyDescription = false,
  duplicateKeyDescription = false,
  corruptSignature = false,
}) {
  const extensions = [];
  extensions.push(
    derSeq(
      oid(OID_BASIC_CONSTRAINTS),
      derOctetString(isCa ? derSeq(derBoolean(true)) : derSeq()),
    ),
  );
  if (!omitKeyDescription) {
    extensions.push(derSeq(oid(OID_KEY_DESCRIPTION), derOctetString(buildKeyDescription(keyDescription))));
    if (duplicateKeyDescription) {
      extensions.push(derSeq(oid(OID_KEY_DESCRIPTION), derOctetString(buildKeyDescription(keyDescription))));
    }
  }
  const tbs = derSeq(
    der(0xa0, derInt(2)), // version v3
    derInt(serial),
    algorithmIdentifier(),
    rdnCommonName(issuerCommonName),
    derSeq(derUtcTime(notBefore), derUtcTime(notAfter)),
    rdnCommonName(subjectCommonName),
    subjectPublicKeyDer,
    der(0xa3, derSeq(...extensions)), // [3] EXPLICIT Extensions
  );
  const signer = createSign('SHA256');
  signer.update(tbs);
  let signature = signer.sign(issuerPrivateKey); // DER ECDSA signature (X.509 form)
  if (corruptSignature) {
    signature = Buffer.from(signature);
    signature[signature.length - 1] ^= 0xff;
  }
  return {
    tbs,
    certificateDer: derSeq(tbs, algorithmIdentifier(), derBitString(signature)),
  };
}

function spkiDer(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' });
}

/** Builds a fresh EC P-256 keypair plus its canonical SEC1 uncompressed unpadded base64url encoding. */
export function generateP256KeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const canonical = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]).toString('base64url');
  return { publicKey, privateKey, canonicalPublicKey: canonical };
}

/**
 * Builds one full chain: pinnedRoot -> intermediate -> leaf.
 * Returns DER buffers (leaf first) in exactly the wire order the Android
 * client produces, plus the pinned root PEM for configuration.
 */
export function buildAttestationChain(options = {}) {
  const {
    leafKeyPair = generateP256KeyPair(),
    securityLevel = 1,
    attestationVersion = 3,
    keymasterVersion = 4,
    keymasterSecurityLevel = 1,
    includeUnknownTeeEntry = false,
    challenge = Buffer.from('fixture-challenge', 'utf8'),
    tee = undefined,
    software = undefined,
    omitKeyDescription = false,
    duplicateKeyDescription = false,
    corruptLeafSignature = false,
    expiredLeaf = false,
    notYetValidLeaf = false,
    expiredIntermediate = false,
    leafIsCa = false,
    omitIntermediate = false,
    omitRootInChain = false,
    alternateRoot = false,
  } = options;

  const now = Date.now();
  const notBefore = new Date(now - 60_000);
  const notAfter = new Date(now + 24 * 3600_000);
  const leafNotBefore = notYetValidLeaf ? new Date(now + 3600_000) : notBefore;
  const leafNotAfter = expiredLeaf ? new Date(now - 60_000) : notAfter;
  const intermediateNotAfter = expiredIntermediate ? new Date(now - 60_000) : notAfter;

  const root = generateP256KeyPair();
  const intermediate = generateP256KeyPair();
  const intermediatesIssuer = alternateRoot ? null : root;

  const rootCert = buildCertificate({
    subjectCommonName: 'PCA Wave6C Fixture Root',
    issuerCommonName: 'PCA Wave6C Fixture Root',
    subjectPublicKeyDer: spkiDer(root.publicKey),
    issuerPrivateKey: root.privateKey,
    serial: 1,
    notBefore,
    notAfter,
    isCa: true,
    omitKeyDescription: true,
  });
  const intermediateIssuerKey = alternateRoot ? generateP256KeyPair() : intermediate;
  const intermediateCert = buildCertificate({
    subjectCommonName: 'PCA Wave6C Fixture Intermediate',
    issuerCommonName: alternateRoot ? 'PCA Wave6C Rogue Root' : 'PCA Wave6C Fixture Root',
    subjectPublicKeyDer: spkiDer(intermediate.publicKey),
    issuerPrivateKey: alternateRoot ? intermediateIssuerKey.privateKey : root.privateKey,
    serial: 2,
    notBefore,
    notAfter: intermediateNotAfter,
    isCa: true,
    omitKeyDescription: true,
  });
  const leafCert = buildCertificate({
    subjectCommonName: 'PCA Wave6C Fixture Leaf',
    issuerCommonName: 'PCA Wave6C Fixture Intermediate',
    subjectPublicKeyDer: spkiDer(leafKeyPair.publicKey),
    issuerPrivateKey: intermediate.privateKey,
    serial: 3,
    notBefore: leafNotBefore,
    notAfter: leafNotAfter,
    isCa: leafIsCa,
    keyDescription: { securityLevel, attestationVersion, keymasterVersion, keymasterSecurityLevel, includeUnknownTeeEntry, challenge, ...(tee ? { tee } : {}), ...(software ? { software } : {}) },
    omitKeyDescription,
    duplicateKeyDescription,
    corruptSignature: corruptLeafSignature,
  });

  const chainDer = [leafCert.certificateDer];
  if (!omitIntermediate) chainDer.push(intermediateCert.certificateDer);
  if (!omitRootInChain) chainDer.push(rootCert.certificateDer);
  return {
    root,
    intermediate,
    leafKeyPair,
    rootPem: `-----BEGIN CERTIFICATE-----\n${rootCert.certificateDer.toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END CERTIFICATE-----\n`,
    chainDer,
  };
}

/** Builds the evidence JSON string the Android client would submit. */
export function buildEvidence({ attemptId, chainDer }) {
  return JSON.stringify({
    v: 1,
    platform: 'ANDROID',
    attemptId,
    chain: chainDer.map((der) => der.toString('base64url')),
  });
}

export function randomAttemptId() {
  return randomBytes(24).toString('base64url');
}

/** Minimal verifier input builder; every field overridable. */
export function buildInput(overrides = {}) {
  const now = new Date();
  return {
    familyId: 'family-1',
    deviceId: 'device-1',
    ceremonyId: 'ceremony-1',
    challengeId: 'challenge-1',
    nonce: 'nonce',
    platform: 'ANDROID',
    attestationEvidence: null,
    expectedDskKeyId: 'dsk-key-1',
    expectedDskPublicKey: 'unset',
    expectedDskAlgorithm: 'ECDSA_P256_SHA256',
    now,
    ...overrides,
  };
}
