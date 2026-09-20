import { signWithEndpointKey } from './trustedEndpointKeyStore';

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

const DOMAIN = 'PCA_FAMILY_GENESIS_PROOF_V1';
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/;

function lengthPrefixed(fields: readonly string[]): string {
  return fields.map((field) => `${new TextEncoder().encode(field).byteLength}:${field}`).join('');
}

/** Browser counterpart of backend/src/parentaccount/genesisProtocol.ts. */
export function canonicalizeGenesisProof(fields: GenesisProofFields): string {
  if (fields.protocolVersion !== 1 || fields.operation !== 'GENESIS') throw new Error('invalid_genesis_protocol');
  if (!PUBLIC_KEY.test(fields.publicKey) || !NONCE.test(fields.nonce)) throw new Error('invalid_genesis_encoding');
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

export async function signGenesisProof(fields: GenesisProofFields): Promise<string> {
  const signature = await signWithEndpointKey(new TextEncoder().encode(canonicalizeGenesisProof(fields)));
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
