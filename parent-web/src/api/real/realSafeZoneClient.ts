import type { NewSafeZoneInput, SafeZone, SafeZoneClient, SafeZonePatch } from '../interfaces';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';
const ACTOR_DEVICE_HEADER = 'x-pca-actor-device-id';
const SAFE_ZONE_KEYS = new Set([
  'zoneId',
  'familyId',
  'recipientEndpointId',
  'ciphertextB64',
  'nonceB64',
  'keyEpoch',
  'revision',
  'deliveryState',
  'createdAtUtc',
  'updatedAtUtc',
]);
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const OPAQUE_BASE64 = /^[A-Za-z0-9_-]{2,87380}$/;

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error('SAFE_ZONE_RESPONSE_INVALID');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUtcTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/**
 * Accepts only the opaque Safe Zone service contract. In particular, this
 * rejects any response that adds readable label/coordinate/radius/policy
 * fields instead of silently carrying them into the UI.
 */
function parseSafeZone(value: unknown, familyId: string): SafeZone {
  if (!isRecord(value) || Object.keys(value).some((key) => !SAFE_ZONE_KEYS.has(key))) {
    throw new Error('SAFE_ZONE_RESPONSE_INVALID');
  }
  if (
    typeof value.zoneId !== 'string' || !OPAQUE_TOKEN.test(value.zoneId) ||
    value.familyId !== familyId ||
    typeof value.recipientEndpointId !== 'string' || !OPAQUE_TOKEN.test(value.recipientEndpointId) ||
    typeof value.ciphertextB64 !== 'string' || !OPAQUE_BASE64.test(value.ciphertextB64) ||
    typeof value.nonceB64 !== 'string' || !OPAQUE_BASE64.test(value.nonceB64) ||
    typeof value.keyEpoch !== 'number' || !Number.isInteger(value.keyEpoch) || value.keyEpoch <= 0 ||
    typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision <= 0 ||
    (value.deliveryState !== 'PENDING_OFFLINE' && value.deliveryState !== 'READY') ||
    !isUtcTimestamp(value.createdAtUtc) ||
    !isUtcTimestamp(value.updatedAtUtc)
  ) {
    throw new Error('SAFE_ZONE_RESPONSE_INVALID');
  }
  return {
    zoneId: value.zoneId,
    familyId: value.familyId,
    recipientEndpointId: value.recipientEndpointId,
    ciphertextB64: value.ciphertextB64,
    nonceB64: value.nonceB64,
    keyEpoch: value.keyEpoch,
    revision: value.revision,
    deliveryState: value.deliveryState,
    createdAtUtc: value.createdAtUtc,
    updatedAtUtc: value.updatedAtUtc,
  };
}

export class RealSafeZoneClient implements SafeZoneClient {
  constructor(private readonly apiBaseUrl: string, private readonly trustedBrowser: TrustedBrowserProvider) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  async list(familyId: string): Promise<SafeZone[]> {
    const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/safe-zones`), { credentials: 'include', headers: { Accept: 'application/json', ...(await this.actorHeaders()) } });
    if (!response.ok) throw new Error(`Safe-zone request failed (${response.status})`);
    const body = await json(response);
    if (!isRecord(body) || !Array.isArray(body.safeZones)) throw new Error('SAFE_ZONE_RESPONSE_INVALID');
    return body.safeZones.map((zone) => parseSafeZone(zone, familyId));
  }

  async create(familyId: string, input: NewSafeZoneInput): Promise<SafeZone> {
    return this.mutate(familyId, '', 'POST', input) as Promise<SafeZone>;
  }

  async update(familyId: string, zoneId: string, patch: SafeZonePatch): Promise<SafeZone> {
    return this.mutate(familyId, zoneId, 'PATCH', patch) as Promise<SafeZone>;
  }

  async remove(familyId: string, zoneId: string): Promise<void> {
    const csrf = readCsrfCookie();
    const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/safe-zones/${encodeURIComponent(zoneId)}`), { method: 'DELETE', credentials: 'include', headers: { ...(await this.actorHeaders()), ...(csrf ? { [CSRF_HEADER_NAME]: csrf } : {}) } });
    if (!response.ok) throw new Error(`Safe-zone deletion failed (${response.status})`);
  }

  private async mutate(familyId: string, zoneId: string, method: 'POST' | 'PATCH', body: unknown): Promise<SafeZone> {
    const csrf = readCsrfCookie();
    const suffix = zoneId ? `/${encodeURIComponent(zoneId)}` : '';
    const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/safe-zones${suffix}`), { method, credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(await this.actorHeaders()), ...(csrf ? { [CSRF_HEADER_NAME]: csrf } : {}) }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Safe-zone update failed (${response.status})`);
    const responseBody = await json(response);
    if (!isRecord(responseBody)) throw new Error('SAFE_ZONE_RESPONSE_INVALID');
    return parseSafeZone(responseBody.safeZone, familyId);
  }

  private async actorHeaders(): Promise<Record<string, string>> {
    const snapshot = await this.trustedBrowser.getSnapshot();
    if (snapshot.state !== 'TRUSTED') throw new Error('TRUSTED_BROWSER_REQUIRED');
    if (!snapshot.browserEndpointId) throw new Error('DEVICE_IDENTITY_UNAVAILABLE');
    return { [ACTOR_DEVICE_HEADER]: snapshot.browserEndpointId };
  }
}
