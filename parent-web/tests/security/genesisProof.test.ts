import { describe, expect, it } from 'vitest';
import { canonicalizeGenesisProof } from '../../src/security/genesisProof';

const EXPECTED_HEX =
  '32373a5043415f46414d494c595f47454e455349535f50524f4f465f5631313a31373a47454e45534953373a616363742dceb1353a7376632d31353a66616d2d31353a6465762d31353a6b65792d3138373a424172516e346d474466443857626d457233793433364c30435f4d786a5275504d57756a6f7030786a724e742d6448425042754764577a694658646a485731643332324473474130434e6738757152526456694d64354531313a6368616c6c656e67652d3134333a3031323334353637383930313233343536373839303132333435363738393031323334353637383961626332343a323032362d30312d30325430333a30343a30352e3637385a32343a323032362d30312d30325430333a30393a30352e3637385a';

const fields = {
  protocolVersion: 1 as const,
  operation: 'GENESIS' as const,
  accountId: 'acct-α',
  serviceAccountId: 'svc-1',
  familyId: 'fam-1',
  deviceId: 'dev-1',
  keyId: 'key-1',
  publicKey: 'BArQn4mGDfD8WbmEr3y436L0C_MxjRuPMWujop0xjrNt-dHBPBuGdWziFXdjHW1d322DsGA0CNg8uqRRdViMd5E',
  challengeId: 'challenge-1',
  nonce: '0123456789012345678901234567890123456789abc',
  createdAt: '2026-01-02T03:04:05.678Z',
  expiresAt: '2026-01-02T03:09:05.678Z',
};

function toHex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('GENESIS_PROOF_V1 cross-client canonicalization', () => {
  it('matches the backend normative vector byte-for-byte', () => {
    expect(toHex(canonicalizeGenesisProof(fields))).toBe(EXPECTED_HEX);
  });

  it('rejects non-canonical public-key and nonce encodings', () => {
    expect(() => canonicalizeGenesisProof({ ...fields, publicKey: `${fields.publicKey}=` })).toThrow(
      'invalid_genesis_encoding',
    );
    expect(() => canonicalizeGenesisProof({ ...fields, nonce: 'short' })).toThrow('invalid_genesis_encoding');
  });
});
