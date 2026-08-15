// FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61) -- real, HTTP-backed
// FreeAccessStatusClient against GET /api/parent/free-access-status
// (backend/src/http/routes/parentAccountRoutes.ts, additive route). Same
// cookie-session transport as ../real/realServiceAuthClient.ts
// (`credentials: 'include'`, no bearer token, no CSRF needed for a read).
import type { FreeAccessStatusClient } from '../interfaces';
import type { FreeAccessStatus } from '../../domain/freeAccess';

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export class RealFreeAccessStatusClient implements FreeAccessStatusClient {
  constructor(private readonly apiBaseUrl: string) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  /**
   * Returns null for every "there is honestly no status to show" case --
   * no session (401), account has no snapshot yet (404), the backend
   * dependency has not been wired in yet (503, see
   * parentAccountRoutes.ts's own fail-closed handling), or a network
   * failure. The reminder banner's container component (see
   * ../../components/freeaccess/FreeAccessReminderBanner.tsx) treats null
   * as "render nothing" -- never a fabricated/guessed status.
   */
  async getStatus(): Promise<FreeAccessStatus | null> {
    let response: Response;
    try {
      response = await fetch(this.url('/api/parent/free-access-status'), {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    return parseJsonSafe<FreeAccessStatus>(response);
  }
}
