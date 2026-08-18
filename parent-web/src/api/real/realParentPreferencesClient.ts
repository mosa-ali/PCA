import type { ParentPreferences, ParentPreferencesClient, ParentPreferencesPatch } from '../interfaces';

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export class RealParentPreferencesClient implements ParentPreferencesClient {
  constructor(private readonly apiBaseUrl: string) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  async get(): Promise<ParentPreferences> {
    const response = await fetch(this.url('/api/parent/preferences'), { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Preferences request failed (${response.status})`);
    return (await parseJson<{ preferences: ParentPreferences }>(response)).preferences;
  }

  async update(patch: ParentPreferencesPatch): Promise<ParentPreferences> {
    const csrf = readCsrfCookie();
    const response = await fetch(this.url('/api/parent/preferences'), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(csrf ? { [CSRF_HEADER_NAME]: csrf } : {}) },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(`Preferences update failed (${response.status})`);
    return (await parseJson<{ preferences: ParentPreferences }>(response)).preferences;
  }
}
