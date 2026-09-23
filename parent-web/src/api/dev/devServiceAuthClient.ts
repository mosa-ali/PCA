import type { ServiceAuthClient, AuthenticatedSession, GenesisChallenge, GenesisCompletionInput, GenesisPlatform, RegistrationResult, RequestPasswordResetResult, ResetPasswordResult, SignInResult } from '../interfaces';
import { buildDevSession, setGenesisPending, setServiceAuthenticated } from './devState';

const DELAY_MS = 120;
const delay = (ms = DELAY_MS) => new Promise((r) => setTimeout(r, ms));

/** DEVELOPMENT_ONLY fixture implementation of ServiceAuthClient. */
export class DevServiceAuthClient implements ServiceAuthClient {
  async getSession(): Promise<AuthenticatedSession | null> {
    await delay();
    return buildDevSession();
  }

  async signIn(_email: string, _password: string): Promise<SignInResult> {
    await delay();
    setServiceAuthenticated(true);
    // Dev fixture never simulates the risk-based step-up gate -- every dev
    // sign-in authenticates immediately, matching this fixture's existing
    // "always succeed" posture for every other flow.
    return { status: 'AUTHENTICATED', session: buildDevSession() };
  }

  async completeLoginStepUp(_email: string, _code: string): Promise<AuthenticatedSession> {
    await delay();
    setServiceAuthenticated(true);
    return buildDevSession();
  }

  async signOut(): Promise<void> {
    await delay();
    setServiceAuthenticated(false);
  }

  /**
   * DEVELOPMENT_ONLY genesis fixture.
   *
   * Deliberately does NOT shortcut the ceremony: the caller still generates a
   * real non-extractable key and signs with the REAL canonicalization helpers,
   * so dev/demo exercises the browser signing path rather than a mock of it.
   * Only the server's verification is faked.
   */
  async startGenesisStepUp(_email: string, _password: string): Promise<void> {
    await delay();
  }

  async completeGenesisStepUp(_code: string): Promise<void> {
    await delay();
  }

  async requestGenesisChallenge(publicKey: string, platform: GenesisPlatform): Promise<GenesisChallenge> {
    await delay();
    const now = new Date();
    return {
      protocolVersion: 1,
      operation: 'GENESIS',
      accountId: 'dev-account-1',
      serviceAccountId: 'dev-service-account-1',
      familyId: 'dev-family-1',
      deviceId: 'dev-device-1',
      keyId: 'dev-key-1',
      // Echoed back exactly as offered: the signer signs the server's statement,
      // never a locally recomputed copy.
      publicKey,
      platform,
      challengeId: `dev-challenge-${now.getTime()}`,
      nonce: `dev-nonce-${now.getTime()}`,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    };
  }

  async completeGenesis(_input: GenesisCompletionInput): Promise<void> {
    await delay();
    setGenesisPending(false);
  }

  async stepUp(_actionId: string): Promise<{ granted: boolean; expiresAtUtc: string }> {
    await delay(200);
    // Dev stub: always grants after a simulated re-auth prompt handled by the UI.
    return {
      granted: true,
      expiresAtUtc: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
  }

  async register(_email: string, _password: string, _passwordConfirmation: string): Promise<RegistrationResult> {
    await delay();
    return { status: 'PENDING_VERIFICATION' };
  }

  async verifyEmail(_email: string, _code: string): Promise<AuthenticatedSession> {
    await delay();
    setServiceAuthenticated(true);
    return buildDevSession();
  }

  async requestPasswordReset(_email: string): Promise<RequestPasswordResetResult> {
    await delay();
    return { status: 'RESET_CODE_SENT_IF_ACCOUNT_EXISTS' };
  }

  async resetPassword(_email: string, _code: string, _newPassword: string, _newPasswordConfirmation: string): Promise<ResetPasswordResult> {
    await delay();
    return { status: 'PASSWORD_RESET' };
  }
}
