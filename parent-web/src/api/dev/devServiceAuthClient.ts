import type {
  AuthenticatedSession,
  CommercialStepUpGrant,
  CommercialStepUpOperation,
  LoginStepUpResult,
  MfaEnrollmentConfirmResult,
  MfaRecoveryCompletionResult,
  MfaEnrollmentStart,
  RegistrationResult,
  RequestPasswordResetResult,
  ResetPasswordResult,
  ServiceAuthClient,
  SignInResult,
  VerifyEmailResult,
} from '../interfaces';
import { ServiceAuthError } from '../real/realServiceAuthClient';
import { buildDevSession, setDevMfa, setServiceAuthenticated } from './devState';

const DELAY_MS = 120;
const delay = (ms = DELAY_MS) => new Promise((r) => setTimeout(r, ms));

/**
 * The fixture's "wrong code". Every other 6-digit code is accepted, so demo
 * and fixture e2e journeys can exercise both the success and the error path
 * of each authenticator prompt without a real authenticator app.
 */
export const DEV_REJECTED_MFA_CODE = '000000';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let devTotpSecret: string | null = null;

function getDevTotpSecret(): string {
  if (devTotpSecret) return devTotpSecret;
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let encoded = '';
  for (let offset = 0; offset < bits.length; offset += 5) {
    encoded += BASE32_ALPHABET[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, '0'), 2)];
  }
  devTotpSecret = encoded;
  return encoded;
}

function assertCodeAccepted(code: string): void {
  if (!/^\d{6}$/.test(code) || code === DEV_REJECTED_MFA_CODE) {
    throw new ServiceAuthError('INVALID_MFA_CODE', 'That authenticator code is incorrect.');
  }
}

/** DEVELOPMENT_ONLY fixture implementation of ServiceAuthClient. */
export class DevServiceAuthClient implements ServiceAuthClient {
  async getSession(): Promise<AuthenticatedSession | null> {
    await delay();
    return buildDevSession();
  }

  async signIn(_email: string, _password: string, _totpCode?: string): Promise<SignInResult> {
    await delay();
    setServiceAuthenticated(true);
    // Dev fixture never simulates the emailed or authenticator second step --
    // every dev sign-in authenticates immediately, matching this fixture's
    // existing "always succeed" posture for every other flow.
    return { status: 'AUTHENTICATED', session: buildDevSession() };
  }

  async completeLoginStepUp(_email: string, _code: string): Promise<LoginStepUpResult> {
    await delay();
    setServiceAuthenticated(true);
    return { status: 'AUTHENTICATED', session: buildDevSession() };
  }

  async signOut(): Promise<void> {
    await delay();
    setServiceAuthenticated(false);
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

  async verifyEmail(_email: string, _code: string): Promise<VerifyEmailResult> {
    await delay();
    return { status: 'VERIFIED' };
  }

  async requestPasswordReset(_email: string): Promise<RequestPasswordResetResult> {
    await delay();
    return { status: 'RESET_CODE_SENT_IF_ACCOUNT_EXISTS' };
  }

  async resetPassword(_email: string, _code: string, _newPassword: string, _newPasswordConfirmation: string): Promise<ResetPasswordResult> {
    await delay();
    return { status: 'PASSWORD_RESET' };
  }

  async startMfaEnrollment(email: string, _password: string): Promise<MfaEnrollmentStart> {
    await delay();
    const label = encodeURIComponent(`PCA:${email || 'dev'}`);
    const secret = getDevTotpSecret();
    return {
      otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=PCA&algorithm=SHA1&digits=6&period=30`,
      secret,
    };
  }

  async confirmMfaEnrollment(_email: string, code: string): Promise<MfaEnrollmentConfirmResult> {
    await delay();
    assertCodeAccepted(code);
    setDevMfa('ACTIVE');
    return { sessionEstablished: false };
  }

  async requestMfaRecovery(_email: string, _password: string): Promise<void> {
    await delay();
  }

  async completeMfaRecovery(_email: string, _password: string, code: string): Promise<MfaRecoveryCompletionResult> {
    await delay();
    if (!/^\d{6}$/.test(code) || code === DEV_REJECTED_MFA_CODE) {
      throw new ServiceAuthError('INVALID_CREDENTIALS', 'That recovery code is incorrect or has expired.');
    }
    throw new ServiceAuthError('UNKNOWN', 'MFA recovery is available only with the real Parent service.');
  }

  async issueCommercialStepUp(operation: CommercialStepUpOperation, code: string): Promise<CommercialStepUpGrant> {
    await delay();
    assertCodeAccepted(code);
    return {
      stepUpToken: `dev-step-up-${operation}-${Date.now()}`,
      operation,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
  }
}
