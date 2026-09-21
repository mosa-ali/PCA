import type { GenesisCompletionArtifacts, GenesisTransactionRepository } from './GenesisTransactionRepository.js';

export type GenesisFailurePoint =
  | 'AFTER_CHALLENGE_LOCK'
  | 'AFTER_CHALLENGE_CONSUME'
  | 'AFTER_FAMILY'
  | 'AFTER_DEVICE'
  | 'AFTER_KEY'
  | 'AFTER_SCOPE'
  | 'AFTER_MEMBERSHIP'
  | 'AFTER_ACCOUNT'
  | 'AFTER_ANCHOR'
  | 'AFTER_ATTESTATION';

interface GenesisState {
  challengeConsumed: boolean;
  family: boolean;
  device: boolean;
  key: boolean;
  scope: boolean;
  membership: boolean;
  accountFamilyId: string | null;
  anchor: boolean;
  attestation: boolean;
  chainHead: boolean;
}

/** Test double that snapshots all effects so every injected failure proves rollback rather than merely relying on comments. */
export class InMemoryGenesisTransactionRepository implements GenesisTransactionRepository {
  private state: GenesisState = {
    challengeConsumed: false,
    family: false,
    device: false,
    key: false,
    scope: false,
    membership: false,
    accountFamilyId: null,
    anchor: false,
    attestation: false,
    chainHead: false,
  };

  constructor(private readonly failurePoint?: GenesisFailurePoint) {}

  async completeAtomically(input: GenesisCompletionArtifacts): Promise<void> {
    const before = structuredClone(this.state);
    try {
      this.fail('AFTER_CHALLENGE_LOCK');
      this.state.challengeConsumed = true;
      this.fail('AFTER_CHALLENGE_CONSUME');
      this.state.family = true;
      this.fail('AFTER_FAMILY');
      this.state.device = true;
      this.fail('AFTER_DEVICE');
      this.state.key = true;
      this.fail('AFTER_KEY');
      this.state.scope = true;
      this.fail('AFTER_SCOPE');
      this.state.membership = true;
      this.fail('AFTER_MEMBERSHIP');
      this.state.accountFamilyId = input.challenge.familyId;
      this.fail('AFTER_ACCOUNT');
      this.state.anchor = true;
      this.fail('AFTER_ANCHOR');
      this.state.attestation = true;
      this.fail('AFTER_ATTESTATION');
      this.state.chainHead = true;
    } catch (error) {
      this.state = before;
      throw error;
    }
  }

  snapshot(): GenesisState {
    return structuredClone(this.state);
  }

  private fail(point: GenesisFailurePoint): void {
    if (this.failurePoint === point) throw new Error(`injected_genesis_failure:${point}`);
  }
}
