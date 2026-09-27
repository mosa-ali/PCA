import type { ParentIdentityClient, ParentIdentityProfile } from '../interfaces';

const CSRF_COOKIE_NAME = 'pca_family_csrf';
const CSRF_HEADER_NAME = 'X-PCA-CSRF-Token';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1)) : null;
}

async function parseProfile(response: Response): Promise<ParentIdentityProfile> {
  const value = await response.json() as Partial<ParentIdentityProfile>;
  if (typeof value.emailVerified !== 'boolean' || typeof value.phoneVerified !== 'boolean' ||
      !(value.firstName === null || typeof value.firstName === 'string') ||
      !(value.lastName === null || typeof value.lastName === 'string') ||
      !(value.email === null || typeof value.email === 'string') ||
      !(value.phoneNumber === null || typeof value.phoneNumber === 'string')) {
    throw new Error('Parent identity response was incomplete.');
  }
  return value as ParentIdentityProfile;
}

export class RealParentIdentityClient implements ParentIdentityClient {
  constructor(private readonly apiBaseUrl: string) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  async get(): Promise<ParentIdentityProfile> {
    const response = await fetch(this.url('/api/parent/identity'), {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Parent identity request failed (${response.status})`);
    return parseProfile(response);
  }

  async updateNames(input: { firstName: string; lastName: string }): Promise<ParentIdentityProfile> {
    const csrf = readCsrfCookie();
    const response = await fetch(this.url('/api/parent/identity'), {
      method: 'PATCH',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(csrf ? { [CSRF_HEADER_NAME]: csrf } : {}) },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Parent identity update failed (${response.status})`);
    return parseProfile(response);
  }
}
