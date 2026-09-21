import type { DeviceSignatureVerifier } from '../deviceauth/DeviceSignatureVerifier.js';
import { canonicalizeGenesisAnchor } from '../familycommercial/authority/canonicalize.js';
import { canonicalizeOwnerAttestation, computeAttestationId } from '../familycommercial/authority/canonicalize.js';
import { OWNER_ATTESTATION_DOMAIN, FAMILY_AUTHORITY_PROTOCOL_VERSION } from '../familycommercial/authority/types.js';
import type { GenesisChallengeService } from './GenesisChallengeService.js';
import { GenesisChallengeError } from './GenesisChallengeService.js';
import type { GenesisTransactionRepository } from './GenesisTransactionRepository.js';
import type { Platform } from '../device/types.js';
import { hasSaneAttestationTemporalPolicy } from '../familycommercial/authority/policy.js';

export interface BeginParentGenesisInput {
  accountId: string;
  serviceAccountId: string;
  publicKey: string;
  platform?: Platform;
  genesisAuthorizationId: string;
}

export interface CompleteParentGenesisInput {
  challengeId: string;
  proofSignature: string;
  anchorSignature: string;
  attestationSignature: string;
  trustSetEpoch: number;
  keyEpoch: number;
  issuedAt: Date;
  expiresAt: Date;
}

export interface ParentGenesisExpectedIdentity {
  accountId: string;
  serviceAccountId: string;
  sessionIdHash?: string;
  genesisAuthorizationId?: string;
}

export interface ParentGenesisCompletionResult {
  familyId: string;
  deviceId: string;
  keyId: string;
}

/**
 * Coordinates the signed client ceremony and hands exactly one verified
 * artifact set to the atomic repository. It never generates a private key,
 * creates a role independently, or consumes the challenge in a separate
 * transaction.
 */
export class ParentGenesisService {
  constructor(
    private readonly challengeService: GenesisChallengeService,
    private readonly transactionRepository: GenesisTransactionRepository,
    private readonly signatureVerifier: DeviceSignatureVerifier,
    private readonly now: () => Date = () => new Date(),
  ) {}

  begin(input: BeginParentGenesisInput) {
    return this.challengeService.begin(input);
  }

  async complete(input: CompleteParentGenesisInput, expectedIdentity?: ParentGenesisExpectedIdentity): Promise<ParentGenesisCompletionResult> {
    const challenge = await this.challengeService.verifyProof(input.challengeId, input.proofSignature);
    if (expectedIdentity && (challenge.accountId !== expectedIdentity.accountId || challenge.serviceAccountId !== expectedIdentity.serviceAccountId)) {
      throw new GenesisChallengeError('INVALID_SIGNATURE');
    }
    if (expectedIdentity?.genesisAuthorizationId !== undefined && challenge.genesisAuthorizationId !== expectedIdentity.genesisAuthorizationId) {
      throw new GenesisChallengeError('INVALID_SIGNATURE');
    }
    if (!Number.isInteger(input.trustSetEpoch) || input.trustSetEpoch < 1 || !Number.isInteger(input.keyEpoch) || input.keyEpoch < 1) {
      throw new GenesisChallengeError('INVALID_SIGNATURE');
    }
    if (!(input.issuedAt instanceof Date) || Number.isNaN(input.issuedAt.getTime()) || !(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) {
      throw new GenesisChallengeError('INVALID_SIGNATURE');
    }
    if (!hasSaneAttestationTemporalPolicy(input.issuedAt, input.expiresAt, this.now())) throw new GenesisChallengeError('INVALID_SIGNATURE');

    const anchor = {
      familyId: challenge.familyId,
      genesisDeviceId: challenge.candidateDeviceId,
      genesisDskKeyId: challenge.candidateKeyId,
      genesisDskPublicKey: challenge.candidatePublicKey,
      protocolVersion: FAMILY_AUTHORITY_PROTOCOL_VERSION,
      createdAt: challenge.createdAt,
      signature: input.anchorSignature,
    } as const;
    const attestation = {
      familyId: challenge.familyId,
      purpose: OWNER_ATTESTATION_DOMAIN,
      attestationRevision: 1,
      ownerDeviceId: challenge.candidateDeviceId,
      ownerDskKeyId: challenge.candidateKeyId,
      ownerDskPublicKey: challenge.candidatePublicKey,
      trustSetEpoch: input.trustSetEpoch,
      keyEpoch: input.keyEpoch,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      previousAttestationId: null,
      signerDeviceId: challenge.candidateDeviceId,
      signerDskKeyId: challenge.candidateKeyId,
      signerDskPublicKey: challenge.candidatePublicKey,
      signature: input.attestationSignature,
    } as const;

    const anchorValid = await this.signatureVerifier.verify(anchor.genesisDskPublicKey, canonicalizeGenesisAnchor(anchor), anchor.signature);
    const attestationValid = await this.signatureVerifier.verify(attestation.signerDskPublicKey, canonicalizeOwnerAttestation(attestation), attestation.signature);
    if (!anchorValid || !attestationValid) throw new GenesisChallengeError('INVALID_SIGNATURE');

    await this.transactionRepository.completeAtomically({
      challenge,
      anchor,
      attestation,
      attestationId: computeAttestationId(attestation),
      consumedAt: this.now(),
      genesisAuthorizationId: expectedIdentity?.genesisAuthorizationId,
      sessionIdHash: expectedIdentity?.sessionIdHash,
    });
    return { familyId: challenge.familyId, deviceId: challenge.candidateDeviceId, keyId: challenge.candidateKeyId };
  }
}
