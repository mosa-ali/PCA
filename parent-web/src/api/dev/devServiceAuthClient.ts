import type { ServiceAuthClient, AuthenticatedSession } from '../interfaces';
import { buildDevSession, setServiceAuthenticated } from './devState';

const DELAY_MS = 120;
const delay = (ms = DELAY_MS) => new Promise((r) => setTimeout(r, ms));

/** DEVELOPMENT_ONLY fixture implementation of ServiceAuthClient. */
export class DevServiceAuthClient implements ServiceAuthClient {
  async getSession(): Promise<AuthenticatedSession | null> {
    await delay();
    return buildDevSession();
  }

  async signIn(_email: string, _password: string): Promise<AuthenticatedSession> {
    await delay();
    setServiceAuthenticated(true);
    return buildDevSession();
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
}
