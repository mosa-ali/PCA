// Real (non-fixture) TrustedBrowserProvider. The parts that are genuinely
// local to this browser -- service-authentication bookkeeping and endpoint
// key generation -- are real WebCrypto operations, not simulated.
// requestPairing() ALSO now performs the real, HTTP-backed device
// registration + proof-of-possession ceremony described below -- it is no
// longer a purely-local stub. Reaching PAIRED (see BrowserEndpointService's
// own doc comment) additionally requires a SEPARATE, already-real,
// already-wired parent action (POST .../pairing-requests/:deviceId/confirm,
// called from DeviceEnrollmentPanel.tsx) that this class deliberately never
// invokes itself -- the backend rejects the SAME account confirming its own
// registration (SELF_APPROVAL_DENIED).
//
// What remains genuinely out of scope here, and must stay that way: TRUSTED
// status (a real Family Trust Set, a signed epoch, decrypt capability) is a
// SEPARATE trust boundary from PAIRED and is correctly gated elsewhere
// (@pca/parent-sdk-browser-runtime's crypto-review gate, ../client.ts's
// buildRealClients comment) until a human security review approves the
// production E2EE suite. Granting TRUSTED status is exactly the kind of
// decision the DevTrustedBrowserProvider's `simulate*` methods
// short-circuit for demo purposes -- a real implementation must never do
// that, so those methods still throw a clear PairingBackendUnavailableError
// here instead of fabricating trust.
import { canTransition } from '../../domain/trustedBrowser';
import type { TrustedBrowserProvider, TrustedBrowserSnapshot, TrustedBrowserState } from '../../domain/trustedBrowser';
import { generateEndpointSigningKey, clearEndpointKey, signWithEndpointKey } from '../../security/trustedEndpointKeyStore';
import { ServiceUnavailableError } from '../unavailable';
import { cookieSessionFamilyId } from './realBillingClient';

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * BrowserEndpointService.registerEndpoint / publicKey.ts's
 * isPlausiblePublicKey only shape-validates `dskPublicKey` as a base64url
 * blob decoding to 16-256 bytes -- no concrete production signature
 * suite/wire-encoding has been chosen anywhere in this codebase yet
 * (DeviceSignatureVerifier's own doc comment: CRYPTO_SUITE =
 * WAITING_HUMAN_SECURITY_REVIEW). This encodes the REAL public key this
 * endpoint just generated as the standard SEC1 uncompressed EC point
 * (0x04 || x || y -- exactly what `crypto.subtle.exportKey('raw', ...)`
 * would return for this P-256 key), derived from the JWK's own x/y
 * coordinates. Never a fingerprint or other fabricated stand-in: the
 * matching private key genuinely signs the runtime-sync challenge nonce in
 * establishDeviceSession below.
 */
function dskPublicKeyFromJwk(jwk: JsonWebKey): string {
  if (!jwk.x || !jwk.y) {
    throw new Error('TrustedBrowserProvider.requestPairing: generated public key JWK is missing x/y coordinates.');
  }
  const x = base64UrlToBytes(jwk.x);
  const y = base64UrlToBytes(jwk.y);
  const point = new Uint8Array(1 + x.length + y.length);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 1 + x.length);
  return bytesToBase64Url(point);
}

function initialSnapshot(): TrustedBrowserSnapshot {
  return {
    state: 'BROWSER_NOT_TRUSTED',
    serviceAuthenticated: false,
    browserEndpointId: null,
    trustSetEpoch: null,
    acceptedMinEpoch: null,
    pairingRequestedAtUtc: null,
    lastFingerprint: null,
    actorDeviceSessionToken: null,
  };
}

/**
 * Real, WebCrypto- and HTTP-backed TrustedBrowserProvider. State is held in
 * memory per instance (module-scope singleton is constructed once by
 * ../client.ts), consistent with never persisting endpoint trust state in
 * Web Storage across reloads -- see ../../security/trustedEndpointKeyStore.ts.
 *
 * SECURITY (actor-identity binding): `snapshot.actorDeviceSessionToken` is
 * populated by a genuine challenge/response proof-of-possession ceremony in
 * requestPairing() (this endpoint's real, non-extractable DSK signs a
 * server-issued nonce), never a self-reported value. It can still end up
 * `null` after a successful requestPairing() call: `establishDeviceSession`
 * fails closed (catches, returns null) rather than throwing whenever the
 * ceremony doesn't complete -- including, today, every attempt in
 * production, because `DeviceSessionService.completeChallenge` verifies the
 * signature via `RejectingDeviceSignatureVerifier`
 * (backend/src/runtime-sync/RejectingCryptoVerifiers.ts), hardcoded to
 * reject until CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW is resolved.
 * That is an honest, external, out-of-scope gate on a step this class
 * genuinely attempts -- not a reason to skip attempting it. Until it
 * resolves, `RealSafeZoneClient.actorHeaders()` (and similar consumers)
 * continue to throw `ACTOR_DEVICE_SESSION_UNAVAILABLE` for a real
 * (non-dev) browser rather than sending any self-reported identity -- fail
 * closed, not fail-open-with-a-forgeable-header.
 */
export class RealTrustedBrowserProvider implements TrustedBrowserProvider {
  private snapshot: TrustedBrowserSnapshot = initialSnapshot();

  constructor(private readonly apiBaseUrl: string) {}

  private move(to: TrustedBrowserState, patch: Partial<TrustedBrowserSnapshot> = {}): TrustedBrowserSnapshot {
    if (!canTransition(this.snapshot.state, to)) {
      throw new Error(`Illegal trusted-browser transition ${this.snapshot.state} -> ${to}`);
    }
    this.snapshot = { ...this.snapshot, state: to, ...patch };
    return this.snapshot;
  }

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  private csrfHeader(): Record<string, string> {
    const csrf = readCsrfCookie();
    return csrf ? { [CSRF_HEADER_NAME]: csrf } : {};
  }

  async getSnapshot(): Promise<TrustedBrowserSnapshot> {
    return this.snapshot;
  }

  /** Genuinely local: records that the account-level (service) session is authenticated. This is NOT family decryption authority -- see docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 3.2/3.3 and ../../domain/trustedBrowser.ts's header comment. */
  async beginServiceAuthentication(): Promise<TrustedBrowserSnapshot> {
    this.snapshot = { ...this.snapshot, serviceAuthenticated: true };
    return this.move('PAIRING_REQUIRED');
  }

  /**
   * Real, end-to-end pairing-request ceremony:
   *  1. Generates a real, non-extractable ECDSA P-256 keypair for this
   *     endpoint (unchanged), then registers its public key against
   *     `POST /v1/families/:familyId/browser-endpoints`
   *     (backend/src/http/routes/browserEndpointRoutes.ts,
   *     BrowserEndpointService) to obtain a REAL server-issued deviceId --
   *     never a client-fabricated UUID. The family session is resolved via
   *     the same HttpOnly `pca_family_session` cookie every other
   *     cookie-session real client in this app already relies on
   *     (`cookieSessionFamilyId`, ./realBillingClient.ts).
   *  2. Best-effort completes the device challenge/session
   *     proof-of-possession ceremony (`establishDeviceSession` below) so
   *     `actorDeviceSessionToken` can be genuinely populated -- see that
   *     method's doc comment for why a failure there never blocks reaching
   *     PAIRING_PENDING.
   *  3. Does NOT itself call the parent-approval confirm route
   *     (`POST .../pairing-requests/:deviceId/confirm`) -- that is a
   *     separate action performed by another authorized family member
   *     (DeviceEnrollmentPanel.tsx's confirmPairing, already real and
   *     wired against the same route); BrowserEndpointService's own doc
   *     comment states registration always starts PAIRING_PENDING and
   *     rejects the SAME account confirming its own registration.
   *
   * This only ever reaches PAIRING_PENDING -- moving to TRUSTED additionally
   * requires a signed Family Trust Set, which remains out of scope (see
   * class doc comment).
   */
  async requestPairing(): Promise<TrustedBrowserSnapshot> {
    const { publicKeyJwk, fingerprint } = await generateEndpointSigningKey();
    const dskPublicKey = dskPublicKeyFromJwk(publicKeyJwk);

    const familyId = await cookieSessionFamilyId(this.apiBaseUrl);
    if (!familyId) {
      throw new Error(
        'FAMILY_SESSION_UNAVAILABLE: TrustedBrowserProvider.requestPairing needs an authenticated family session to register this browser endpoint.',
      );
    }

    const registerResponse = await fetch(this.url(`/v1/families/${encodeURIComponent(familyId)}/browser-endpoints`), {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...this.csrfHeader(),
      },
      body: JSON.stringify({ dskPublicKey }),
    });
    if (!registerResponse.ok) {
      throw new Error(`TrustedBrowserProvider.requestPairing: browser-endpoint registration failed (${registerResponse.status}).`);
    }
    const registerBody = (await registerResponse.json().catch(() => null)) as { deviceId?: unknown } | null;
    const browserEndpointId = registerBody && typeof registerBody.deviceId === 'string' ? registerBody.deviceId : null;
    if (!browserEndpointId) {
      throw new Error('TrustedBrowserProvider.requestPairing: server did not return a real deviceId.');
    }

    const actorDeviceSessionToken = await this.establishDeviceSession(browserEndpointId);

    return this.move('PAIRING_PENDING', {
      pairingRequestedAtUtc: new Date().toISOString(),
      browserEndpointId,
      lastFingerprint: fingerprint,
      actorDeviceSessionToken,
    });
  }

  /**
   * Real challenge/response proof-of-possession ceremony against
   * `POST /v1/runtime-sync/devices/:deviceId/challenge` then
   * `.../session` (backend/src/http/routes/runtimeSyncRoutes.ts,
   * DeviceSessionService -- neither route requires a session cookie/CSRF,
   * matching their unauthenticated-by-design proof-of-possession model).
   * The nonce is signed with this endpoint's real, non-extractable private
   * key (`signWithEndpointKey`, never exported) and sent as a base64url
   * ECDSA signature.
   *
   * Deliberately best-effort: ANY failure (network error, non-2xx,
   * malformed body) is caught here and resolves to `null` rather than
   * throwing, so a signature genuinely rejected by
   * `RejectingDeviceSignatureVerifier` (see class doc comment) never blocks
   * requestPairing() from reaching PAIRING_PENDING. Never fabricates a
   * token on failure.
   */
  private async establishDeviceSession(deviceId: string): Promise<string | null> {
    try {
      const challengeResponse = await fetch(this.url(`/v1/runtime-sync/devices/${encodeURIComponent(deviceId)}/challenge`), {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      if (!challengeResponse.ok) return null;
      const challengeBody = (await challengeResponse.json().catch(() => null)) as
        | { challengeId?: unknown; nonce?: unknown }
        | null;
      if (!challengeBody || typeof challengeBody.challengeId !== 'string' || typeof challengeBody.nonce !== 'string') {
        return null;
      }

      const signatureBytes = await signWithEndpointKey(new TextEncoder().encode(challengeBody.nonce));
      const signature = bytesToBase64Url(new Uint8Array(signatureBytes));

      const sessionResponse = await fetch(this.url(`/v1/runtime-sync/devices/${encodeURIComponent(deviceId)}/session`), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: challengeBody.challengeId, signature }),
      });
      if (!sessionResponse.ok) return null;
      const sessionBody = (await sessionResponse.json().catch(() => null)) as { sessionToken?: unknown } | null;
      return sessionBody && typeof sessionBody.sessionToken === 'string' ? sessionBody.sessionToken : null;
    } catch {
      return null;
    }
  }

  async simulateParentApproval(): Promise<TrustedBrowserSnapshot> {
    throw new ServiceUnavailableError(
      'TrustedBrowserProvider.simulateParentApproval -- real parent-approval confirmation requires a signed Family Trust Set, which does not exist in this repository slice yet; a real implementation must never fabricate TRUSTED status locally. (PAIRED status, a SEPARATE and unrelated state, is reached via the real pairing-requests/:deviceId/confirm route -- see DeviceEnrollmentPanel.tsx -- not via this method.)',
    );
  }

  async simulateEpochGoneStale(): Promise<TrustedBrowserSnapshot> {
    throw new ServiceUnavailableError(
      'TrustedBrowserProvider.simulateEpochGoneStale -- real epoch transitions are driven by a signed Family Trust Set from the backend relay, not fabricated locally',
    );
  }

  async simulateRevoke(): Promise<TrustedBrowserSnapshot> {
    throw new ServiceUnavailableError(
      'TrustedBrowserProvider.simulateRevoke -- a real revoke must be driven by a signed Family Trust Set from the backend relay, not fabricated locally',
    );
  }

  async reset(): Promise<TrustedBrowserSnapshot> {
    clearEndpointKey();
    this.snapshot = initialSnapshot();
    return this.snapshot;
  }
}
