import { canonicalizeP256Signature, isStrictCanonicalBase64Url } from './p256Signature';

export interface GenesisProofFields {
  protocolVersion: 1;
  operation: 'GENESIS';
  accountId: string;
  serviceAccountId: string;
  familyId: string;
  deviceId: string;
  keyId: string;
  publicKey: string;
  challengeId: string;
  nonce: string;
  createdAt: string;
  expiresAt: string;
}

export interface GenesisAnchorFields {
  familyId: string;
  genesisDeviceId: string;
  genesisDskKeyId: string;
  genesisDskPublicKey: string;
  protocolVersion: number;
  createdAt: string;
}

export interface OwnerAttestationFields {
  familyId: string;
  attestationRevision: number;
  ownerDeviceId: string;
  ownerDskKeyId: string;
  ownerDskPublicKey: string;
  trustSetEpoch: number;
  keyEpoch: number;
  issuedAt: string;
  expiresAt: string;
  previousAttestationId: string | null;
  signerDeviceId: string;
  signerDskKeyId: string;
  signerDskPublicKey: string;
}

const DOMAIN = 'PCA_FAMILY_GENESIS_PROOF_V1';
function lengthPrefixed(fields: readonly string[]): string {
  return fields.map((field) => `${new TextEncoder().encode(field).byteLength}:${field}`).join('');
}

/** Browser counterpart of backend/src/parentaccount/genesisProtocol.ts. */
export function canonicalizeGenesisProof(fields: GenesisProofFields): string {
  if (fields.protocolVersion !== 1 || fields.operation !== 'GENESIS') throw new Error('invalid_genesis_protocol');
  if (!isStrictCanonicalBase64Url(fields.publicKey, 65) || !isStrictCanonicalBase64Url(fields.nonce, 32)) throw new Error('invalid_genesis_encoding');
  return lengthPrefixed([
    DOMAIN,
    String(fields.protocolVersion),
    fields.operation,
    fields.accountId,
    fields.serviceAccountId,
    fields.familyId,
    fields.deviceId,
    fields.keyId,
    fields.publicKey,
    fields.challengeId,
    fields.nonce,
    fields.createdAt,
    fields.expiresAt,
  ]);
}

/**
 * Every genesis signature is made with the EXPLICIT non-extractable key the
 * ceremony generated for this family -- never the pairing module's shared
 * in-memory endpoint key, which has a different lifetime and purpose.
 */
export async function signGenesisProof(fields: GenesisProofFields, privateKey: CryptoKey): Promise<string> {
  return signCanonicalText(canonicalizeGenesisProof(fields), privateKey);
}

const GENESIS_ANCHOR_DOMAIN = 'PCA_FAMILY_AUTHORITY_GENESIS_V1';
const OWNER_ATTESTATION_DOMAIN = 'PCA_FAMILY_COMMERCIAL_OWNER_AUTHORITY_V1';

/** Browser counterpart of backend/src/familycommercial/authority/canonicalize.ts. */
export function canonicalizeGenesisAnchor(fields: GenesisAnchorFields): string {
  if (fields.protocolVersion < 1) throw new Error('invalid_genesis_anchor_protocol');
  if (!isStrictCanonicalBase64Url(fields.genesisDskPublicKey, 65)) throw new Error('invalid_genesis_encoding');
  return lengthPrefixed([
    GENESIS_ANCHOR_DOMAIN,
    fields.familyId,
    fields.genesisDeviceId,
    fields.genesisDskKeyId,
    fields.genesisDskPublicKey,
    String(fields.protocolVersion),
    fields.createdAt,
  ]);
}

/** Browser counterpart of backend/src/familycommercial/authority/canonicalize.ts. */
export function canonicalizeOwnerAttestation(fields: OwnerAttestationFields): string {
  if (fields.attestationRevision < 1 || fields.trustSetEpoch < 1 || fields.keyEpoch < 1) {
    throw new Error('invalid_owner_attestation_epoch');
  }
  if (!isStrictCanonicalBase64Url(fields.ownerDskPublicKey, 65) || !isStrictCanonicalBase64Url(fields.signerDskPublicKey, 65)) {
    throw new Error('invalid_genesis_encoding');
  }
  return lengthPrefixed([
    OWNER_ATTESTATION_DOMAIN,
    fields.familyId,
    String(fields.attestationRevision),
    fields.ownerDeviceId,
    fields.ownerDskKeyId,
    fields.ownerDskPublicKey,
    String(fields.trustSetEpoch),
    String(fields.keyEpoch),
    fields.issuedAt,
    fields.expiresAt,
    fields.previousAttestationId === null ? 'null' : fields.previousAttestationId,
    fields.signerDeviceId,
    fields.signerDskKeyId,
    fields.signerDskPublicKey,
  ]);
}

export async function signGenesisAnchor(fields: GenesisAnchorFields, privateKey: CryptoKey): Promise<string> {
  return signCanonicalText(canonicalizeGenesisAnchor(fields), privateKey);
}

export async function signOwnerAttestation(fields: OwnerAttestationFields, privateKey: CryptoKey): Promise<string> {
  return signCanonicalText(canonicalizeOwnerAttestation(fields), privateKey);
}

async function signCanonicalText(canonicalText: string, privateKey: CryptoKey): Promise<string> {
  // ECDSA P-256 / SHA-256 over the UTF-8 canonical text, normalised to the
  // low-S IEEE-P1363 form the backend verifier requires.
  const raw = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(canonicalText));
  const signature = canonicalizeP256Signature(raw);
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
