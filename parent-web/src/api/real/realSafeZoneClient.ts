import type { NewSafeZoneInput, SafeZone, SafeZoneClient, SafeZonePatch } from '../interfaces';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';
const ACTOR_DEVICE_HEADER = 'x-pca-actor-device-id';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export class RealSafeZoneClient implements SafeZoneClient {
  constructor(private readonly apiBaseUrl: string, private readonly trustedBrowser: TrustedBrowserProvider) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  async list(familyId: string): Promise<SafeZone[]> {
    const response = await fetch(this.url(`/api/parent/families/${encodeURIComponent(familyId)}/safe-zones`), { credentials: 'include', headers: { Accept: 'application/json', ...(await this.actorHeaders()) } });
    if (!response.ok) throw new Error(`Safe-zone request failed (${response.status})`);
    return (await json<{ safeZones: SafeZone[] }>(response)).safeZones;
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
    return (await json<{ safeZone: SafeZone }>(response)).safeZone;
  }

  private async actorHeaders(): Promise<Record<string, string>> {
    const snapshot = await this.trustedBrowser.getSnapshot();
    if (!snapshot.browserEndpointId) throw new Error('DEVICE_IDENTITY_UNAVAILABLE');
    return { [ACTOR_DEVICE_HEADER]: snapshot.browserEndpointId };
  }
}
