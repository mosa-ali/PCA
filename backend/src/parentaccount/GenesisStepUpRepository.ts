export const GENESIS_STEP_UP_OPERATION = 'FAMILY_GENESIS' as const;

export interface NewGenesisStepUpAuthorization {
  authorizationId: string;
  accountId: string;
  serviceAccountId: string;
  sessionIdHash: string;
  operation: typeof GENESIS_STEP_UP_OPERATION;
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface GenesisStepUpAuthorization extends NewGenesisStepUpAuthorization {
  attemptCount: number;
  verifiedAt: Date | null;
  consumedAt: Date | null;
}

export interface GenesisStepUpRepository {
  create(record: NewGenesisStepUpAuthorization): Promise<void>;
  findLatestForSession(input: {
    accountId: string;
    serviceAccountId: string;
    sessionIdHash: string;
  }): Promise<GenesisStepUpAuthorization | null>;
  incrementAttempt(authorizationId: string): Promise<void>;
  verifyCodeAtomically(authorizationId: string, verifiedAt: Date): Promise<boolean>;
  findVerifiedForSession(input: {
    accountId: string;
    serviceAccountId: string;
    sessionIdHash: string;
    now: Date;
  }): Promise<GenesisStepUpAuthorization | null>;
  consumeAtomically(input: {
    authorizationId: string;
    accountId: string;
    serviceAccountId: string;
    sessionIdHash: string;
    operation: typeof GENESIS_STEP_UP_OPERATION;
    consumedAt: Date;
  }): Promise<boolean>;
}
