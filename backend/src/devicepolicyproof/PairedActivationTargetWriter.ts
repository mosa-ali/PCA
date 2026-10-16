import type { FamilyEnvelope } from '../familyenvelope/types.js';

export interface PairedActivationTargetWrite {
  familyId: string;
  senderDeviceId: string;
  senderDskKeyId: string;
  recipientDeviceId: string;
  trustSetEpoch: number;
  keyEpoch: number;
  envelope: FamilyEnvelope;
}

export interface PairedActivationTargetWriter {
  storePairedPolicyTarget(input: PairedActivationTargetWrite): Promise<'STORED' | 'IDEMPOTENT' | 'REJECTED'>;
}
