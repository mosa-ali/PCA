// Fixture helper: completes the REAL client-key family genesis ceremony for an
// already email-verified parent account in a disposable database.
//
// WHY THIS EXISTS
// ---------------
// Every fixture script in this directory that used to obtain a familyId from
// `ParentAccountService.verifyEmail` has been broken since PCA-DEC-020-R1
// (commit 109f280d, "security: implement PCA-DEC-020-R1 trust bootstrap
// boundary"). That change made email verification establish ACCOUNT IDENTITY
// ONLY: verifyEmail now deliberately returns `familyId: null`, and
// ParentAccountService gained an entirely separate, explicit client-key
// genesis ceremony (`requestGenesisStepUp` -> `completeGenesisStepUp` ->
// `beginGenesisChallenge` -> `completeGenesis`). A parent who has only
// verified their email therefore has no family, and `login` resolves
// `role: null` for them (ParentAccountService.resolveFamilyRole fails closed
// on a null familyId).
//
// The Parent Web client now models that split explicitly rather than
// rejecting it: a verified account whose session has no family yet resolves to
// `AuthenticatedSession.state === 'GENESIS_REQUIRED'`, and the app routes that
// state to genesis onboarding. Only a session carrying a real family role
// ('FAMILY_READY') may reach /dashboard. The one case still rejected as
// UNAUTHORIZED_FAMILY_SCOPE is a self-inconsistent session in which familyId
// and role disagree (exactly one of them null), which no production path can
// produce. The real-backend E2E suites assert this split.
//
// NOTHING HERE WEAKENS A PRODUCTION CONTROL. This helper drives the SAME
// ParentAccountService methods the production HTTP routes drive, with a real
// P-256 device signing key whose signatures are verified by a REAL
// P256DeviceSignatureVerifier (not an always-allow fake). The only
// substitution is the same one `backend/test/security/genesisTransaction
// .test.mjs` and `seed-local.mjs` already established as sanctioned: the
// genesis ceremony's verifier is swapped from production's fail-closed
// `RejectingDeviceSignatureVerifier` (which exists only because the crypto
// suite is pending human security review) to the genuine P-256 verifier.
// The step-up email code is read back through the in-process
// TestSandboxEmailSender, which refuses to construct outside test/development
// and cannot deliver mail. Everything is deleted with the disposable database.
//
// Callers must already hold a live session for the account: genesis is bound
// to the exact session (`sessionIdHash`) that requested the step-up, so this
// helper takes the raw session token `verifyEmail` returned.
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { canonicalizeP256Signature } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { GenesisChallengeService } from '../../dist/parentaccount/GenesisChallengeService.js';
import { MySqlGenesisChallengeRepository } from '../../dist/parentaccount/MySqlGenesisChallengeRepository.js';
import { MySqlGenesisStepUpRepository } from '../../dist/parentaccount/MySqlGenesisStepUpRepository.js';
import { MySqlGenesisTransactionRepository } from '../../dist/parentaccount/MySqlGenesisTransactionRepository.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { ParentGenesisService } from '../../dist/parentaccount/ParentGenesisService.js';
import { generateDailyLoginGrant } from '../../dist/parentaccount/dailyLoginGrant.js';
import { canonicalizeGenesisProof } from '../../dist/parentaccount/genesisProtocol.js';
import { DAILY_LOGIN_GRANT_TTL_MS } from '../../dist/parentaccount/policy.js';
import {
  canonicalizeGenesisAnchor,
  canonicalizeOwnerAttestation,
} from '../../dist/familycommercial/authority/canonicalize.js';

/**
 * The bare cookie name. The production `__Host-` prefix is deliberately not
 * applied under NODE_ENV=development, which is what every fixture run uses.
 */
export const DAILY_LOGIN_GRANT_COOKIE_NAME = 'pca_parent_daily_login_grant';

/**
 * Issues a REAL daily-login grant for `accountId` through the same repository
 * method and the same production TTL ParentAccountService uses, and returns the
 * RAW token -- the only value that exists outside the database, and the one the
 * browser must present as DAILY_LOGIN_GRANT_COOKIE_NAME.
 *
 * Only the domain-separated SHA-256 hash is persisted, exactly as production
 * does. This is why provision-e2e-accounts.mjs and seed-local.mjs both route
 * through here rather than each re-implementing the insert: a grant is a
 * credential, and there is exactly one sanctioned way to mint one.
 */
export async function issueDailyLoginGrant({ repository, accountId, now = new Date(), ttlMs = DAILY_LOGIN_GRANT_TTL_MS }) {
  const grant = generateDailyLoginGrant();
  await repository.insertDailyLoginGrant({
    grantId: randomUUID(),
    accountId,
    tokenHash: grant.tokenHash,
    purpose: 'PARENT_DAILY_LOGIN',
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  });
  return grant.rawToken;
}

/**
 * One hour, comfortably inside hasSaneAttestationTemporalPolicy's
 * [MIN_ATTESTATION_TTL_MS, MAX_ATTESTATION_TTL_MS] (1s .. 30d) window and far
 * longer than this helper's own lifetime.
 */
const ATTESTATION_TTL_MS = 60 * 60 * 1000;

/**
 * BROWSER is the platform a fixture script's genesis device genuinely is:
 * these accounts are used by Playwright browser suites. `isGenesisPlatform`
 * accepts BROWSER/ANDROID/IOS; picking the truthful one matters because it is
 * written into the challenge and the membership, not merely a label.
 */
const GENESIS_PLATFORM = 'BROWSER';

const GENESIS_TRUST_SET_EPOCH = 1;
const GENESIS_KEY_EPOCH = 1;
const GENESIS_ATTESTATION_REVISION = 1;

/**
 * A real P-256 (ES256) device signing key, encoded exactly as
 * `isCanonicalP256PublicKey` requires: uncompressed point (0x04 || X || Y),
 * base64url -- the same encoding backend/test/security/genesisTransaction
 * .test.mjs uses for the same ceremony.
 */
function createDeviceSigningKey() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]).toString('base64url');
  return { privateKey: pair.privateKey, publicKey };
}

/** ieee-p1363 (raw r||s) is the form canonicalizeP256Signature accepts; DER would be rejected. */
function signCanonical(privateKey, message) {
  return canonicalizeP256Signature(
    nodeSign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' }),
  ).toString('base64url');
}

/**
 * Runs the full genesis ceremony for `email` against an open session and
 * returns ParentGenesisService's completion result
 * ({ familyId, deviceId, keyId }).
 *
 * @param {object} args
 * @param {import('../../dist/parentaccount/ParentAccountService.js').ParentAccountService} args.parentAccountService
 * @param {{ lastCodeFor(email: string, kind: string): string | null }} args.emailSender
 * @param {string} args.sessionToken raw session token returned by verifyEmail
 * @param {string} args.email
 * @param {string} args.password
 * @param {() => Date} [args.now]
 */
export async function completeFamilyGenesis({ parentAccountService, emailSender, sessionToken, email, password, now = () => new Date() }) {
  await parentAccountService.requestGenesisStepUp(sessionToken, email, password);
  const code = emailSender.lastCodeFor(email, 'GENESIS_STEP_UP');
  if (!code) throw new Error(`no genesis step-up code was recorded for ${email}.`);
  await parentAccountService.completeGenesisStepUp(sessionToken, code);

  const { privateKey, publicKey } = createDeviceSigningKey();
  const challenge = await parentAccountService.beginGenesisChallenge(sessionToken, {
    publicKey,
    platform: GENESIS_PLATFORM,
  });

  // Every field below is copied from the challenge rather than re-derived:
  // the challenge is the server's own statement of what is being signed, and a
  // fixture that recomputed any of it would be signing something the server
  // never issued.
  const proof = {
    protocolVersion: challenge.protocolVersion,
    operation: challenge.operation,
    accountId: challenge.accountId,
    serviceAccountId: challenge.serviceAccountId,
    familyId: challenge.familyId,
    deviceId: challenge.candidateDeviceId,
    keyId: challenge.candidateKeyId,
    publicKey: challenge.candidatePublicKey,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    createdAt: challenge.createdAt,
    expiresAt: challenge.expiresAt,
  };
  const anchor = {
    familyId: challenge.familyId,
    genesisDeviceId: challenge.candidateDeviceId,
    genesisDskKeyId: challenge.candidateKeyId,
    genesisDskPublicKey: challenge.candidatePublicKey,
    protocolVersion: 1,
    createdAt: challenge.createdAt,
  };
  const issuedAt = now();
  const expiresAt = new Date(issuedAt.getTime() + ATTESTATION_TTL_MS);
  const attestation = {
    familyId: challenge.familyId,
    purpose: 'PCA_FAMILY_COMMERCIAL_OWNER_AUTHORITY_V1',
    attestationRevision: GENESIS_ATTESTATION_REVISION,
    ownerDeviceId: challenge.candidateDeviceId,
    ownerDskKeyId: challenge.candidateKeyId,
    ownerDskPublicKey: challenge.candidatePublicKey,
    trustSetEpoch: GENESIS_TRUST_SET_EPOCH,
    keyEpoch: GENESIS_KEY_EPOCH,
    issuedAt,
    expiresAt,
    previousAttestationId: null,
    signerDeviceId: challenge.candidateDeviceId,
    signerDskKeyId: challenge.candidateKeyId,
    signerDskPublicKey: challenge.candidatePublicKey,
  };

  return parentAccountService.completeGenesis(sessionToken, {
    challengeId: challenge.challengeId,
    proofSignature: signCanonical(privateKey, canonicalizeGenesisProof(proof)),
    anchorSignature: signCanonical(privateKey, canonicalizeGenesisAnchor(anchor)),
    attestationSignature: signCanonical(privateKey, canonicalizeOwnerAttestation(attestation)),
    trustSetEpoch: GENESIS_TRUST_SET_EPOCH,
    keyEpoch: GENESIS_KEY_EPOCH,
    issuedAt,
    expiresAt,
  });
}

/**
 * The ParentAccountService dependency set that exposes the genesis ceremony.
 *
 * Production wires these in main.ts with `RejectingDeviceSignatureVerifier` as
 * BOTH verifiers (fail-closed pending human security review of the crypto
 * suite). A fixture CANNOT complete genesis through that wiring -- and must not
 * be able to, which is the point of it. Each caller therefore passes the
 * genuine `P256DeviceSignatureVerifier` explicitly, so the substitution is
 * stated at the call site rather than hidden here.
 *
 * Shared so the two fixture scripts cannot drift apart in how they compose the
 * service; only the verifier argument differs.
 */
export function createDisposableGenesisParentAccountService({ emailSender, verifier, now = () => new Date() }) {
  return new ParentAccountService({
    repository: new MySqlParentAccountRepository(),
    authService: new AuthService(new MySqlAuthRepository()),
    emailSender,
    parentGenesisService: new ParentGenesisService(
      new GenesisChallengeService(new MySqlGenesisChallengeRepository(), verifier, now),
      new MySqlGenesisTransactionRepository(),
      verifier,
      now,
    ),
    genesisStepUpRepository: new MySqlGenesisStepUpRepository(),
    now,
  });
}
