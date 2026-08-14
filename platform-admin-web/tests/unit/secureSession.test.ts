import { beforeEach, describe, expect, it } from 'vitest';
import { secureSession } from '../../src/security/secureSession';

describe('secureSession', () => {
  beforeEach(() => {
    secureSession.clear();
  });

  it('starts with no session', () => {
    expect(secureSession.get()).toBeNull();
    expect(secureSession.isExpired()).toBe(true);
  });

  it('stores and retrieves a token/expiry pair', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    secureSession.set('token-abc', future);
    expect(secureSession.get()).toEqual({ token: 'token-abc', expiresAt: future });
    expect(secureSession.isExpired()).toBe(false);
  });

  it('treats a past expiresAt as expired', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    secureSession.set('token-abc', past);
    expect(secureSession.isExpired()).toBe(true);
  });

  it('clear() removes the session and notifies subscribers', () => {
    secureSession.set('token-abc', new Date(Date.now() + 60_000).toISOString());
    let notified = false;
    const unsubscribe = secureSession.subscribe(() => {
      notified = true;
    });
    secureSession.clear();
    expect(secureSession.get()).toBeNull();
    expect(notified).toBe(true);
    unsubscribe();
  });
});
