import { config } from '../config/env';
import { PlatformAdminApiError } from './platformAdminAuthClient';

function url(path: string): string { return new URL(`${config.apiBaseUrl}${path}`, window.location.origin).toString(); }
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(url(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new PlatformAdminApiError(response.status, 'activation_failed');
  return (await response.json()) as T;
}
export const platformAdminActivationApi = {
  start: (token: string) => post<{ otpauthUri: string }>('/platform-admin/activation/start', { token }),
  complete: (token: string, password: string, totpCode: string) => post<{ status: 'COMPLETE' }>('/platform-admin/activation/complete', { token, password, totpCode }),
};
