import { describe, expect, it } from 'vitest';
import { safeReturnPath } from '../../src/pages/auth/Login';

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);

/**
 * Open-redirect regression suite for the post-login return path.
 *
 * `from` reaches Login.tsx as the raw `location.pathname` recorded by
 * components/shell/AppLayout.tsx's auth gate, and App.tsx's `path="*"`
 * catch-all sits inside that gated block -- so an attacker fully controls
 * this string by choosing the URL the victim opens. Each hostile case below
 * is paired with the real URL resolution it would have produced, asserted
 * here rather than asserted from memory.
 */
describe('safeReturnPath -- open redirect guard', () => {
  const ORIGIN = 'https://parent.pca.app';

  it('keeps ordinary in-app paths untouched', () => {
    expect(safeReturnPath('/dashboard')).toBe('/dashboard');
    expect(safeReturnPath('/children/abc/policy')).toBe('/children/abc/policy');
    expect(safeReturnPath('/subscription?tab=invoices')).toBe('/subscription?tab=invoices');
    expect(safeReturnPath('/settings#section')).toBe('/settings#section');
    expect(safeReturnPath('/')).toBe('/');
  });

  it('rejects the protocol-relative bypass //evil.com/x', () => {
    // The exact attack: https://parent.pca.app//evil.com/x has this pathname.
    expect(new URL(`${ORIGIN}//evil.com/x`).pathname).toBe('//evil.com/x');
    // ...and assigning it resolves off-origin.
    expect(new URL('//evil.com/x', ORIGIN).href).toBe('https://evil.com/x');
    expect(safeReturnPath('//evil.com/x')).toBe('/dashboard');
  });

  it('rejects the backslash variants browsers normalise to slashes', () => {
    expect(new URL('/\\evil.com/x', ORIGIN).href).toBe('https://evil.com/x');
    expect(safeReturnPath('/\\evil.com/x')).toBe('/dashboard');
    expect(safeReturnPath('/\\\\evil.com')).toBe('/dashboard');
    // A leading backslash with no slash at all is not an absolute path either.
    expect(safeReturnPath('\\\\evil.com')).toBe('/dashboard');
    expect(safeReturnPath('\\evil.com')).toBe('/dashboard');
  });

  it('rejects tab/LF/CR smuggling, which the URL parser strips before resolving', () => {
    // Without this guard `/<TAB>/evil.com/x` becomes //evil.com/x at navigation time.
    expect(new URL(`/${TAB}/evil.com/x`, ORIGIN).href).toBe('https://evil.com/x');
    expect(new URL(`/${LF}/evil.com/x`, ORIGIN).href).toBe('https://evil.com/x');
    expect(safeReturnPath(`/${TAB}/evil.com/x`)).toBe('/dashboard');
    expect(safeReturnPath(`/${LF}/evil.com/x`)).toBe('/dashboard');
    expect(safeReturnPath(`/${CR}/evil.com/x`)).toBe('/dashboard');
    expect(safeReturnPath(`/dash${NUL}board`)).toBe('/dashboard');
  });

  it('rejects absolute URLs and dangerous schemes', () => {
    expect(safeReturnPath('https://evil.com')).toBe('/dashboard');
    expect(safeReturnPath('https://evil.com/x')).toBe('/dashboard');
    expect(safeReturnPath('http://evil.com')).toBe('/dashboard');
    expect(safeReturnPath('javascript:alert(1)')).toBe('/dashboard');
    expect(safeReturnPath('data:text/html,<script>alert(1)</script>')).toBe('/dashboard');
    expect(safeReturnPath('vbscript:msgbox(1)')).toBe('/dashboard');
  });

  it('rejects anything that is not a single-slash-prefixed string', () => {
    expect(safeReturnPath('dashboard')).toBe('/dashboard');
    expect(safeReturnPath('')).toBe('/dashboard');
    expect(safeReturnPath(' /dashboard')).toBe('/dashboard');
    expect(safeReturnPath(undefined)).toBe('/dashboard');
    expect(safeReturnPath(null)).toBe('/dashboard');
    expect(safeReturnPath(42)).toBe('/dashboard');
    expect(safeReturnPath({ from: '/dashboard' })).toBe('/dashboard');
  });

  it('every accepted value really does stay on the current origin', () => {
    const inputs = [
      '/dashboard',
      '//evil.com/x',
      '/\\evil.com/x',
      `/${TAB}/evil.com/x`,
      'https://evil.com/x',
      'javascript:alert(1)',
      '/subscription?next=//evil.com',
    ];
    for (const input of inputs) {
      expect(new URL(safeReturnPath(input), ORIGIN).origin).toBe(ORIGIN);
    }
  });
});
