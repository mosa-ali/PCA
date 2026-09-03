import { describe, expect, it } from 'vitest';
import { isSameOriginRedirect } from '../../src/domain/billing';

/**
 * Checkout-redirect handoff safety.
 *
 * Read the assertions with the call site in mind
 * (pages/billing/DeviceIncreaseRequest.tsx):
 *   false -> window.location.assign(redirectUrl)   <- the PRIVILEGED answer
 *   true  -> the SPA's own router handles it       <- the safe answer
 * So `false` must only ever appear for a target positively classified as a
 * legitimate different-origin provider handoff.
 */
describe('isSameOriginRedirect -- browser-handoff gate', () => {
  const ORIGIN = 'https://parent.pca.app';
  const DEV_ORIGIN = 'http://localhost:4000';

  it('keeps genuine in-app paths in the router (DevBillingClient / sandbox provider shapes)', () => {
    expect(isSameOriginRedirect('/subscription/checkout-return?requestId=r1', ORIGIN)).toBe(true);
    expect(isSameOriginRedirect('/billing/sandbox/checkout/ref-1', ORIGIN)).toBe(true);
    expect(isSameOriginRedirect('/', ORIGIN)).toBe(true);
  });

  it('still hands off a real different-origin https provider URL', () => {
    expect(isSameOriginRedirect('https://provider.example/pay/abc', ORIGIN)).toBe(false);
    expect(isSameOriginRedirect('https://checkout.stripe.com/c/pay/xyz', ORIGIN)).toBe(false);
  });

  it('keeps an absolute SAME-origin URL in the router', () => {
    expect(isSameOriginRedirect(`${ORIGIN}/subscription/checkout-return`, ORIGIN)).toBe(true);
  });

  it('allows an http loopback handoff (the local dev/e2e stack) but not http elsewhere', () => {
    expect(isSameOriginRedirect('http://localhost:4001/billing/sandbox/checkout/r1', DEV_ORIGIN)).toBe(false);
    expect(isSameOriginRedirect('http://127.0.0.1:4001/billing/sandbox/checkout/r1', DEV_ORIGIN)).toBe(false);
    // A downgraded, non-loopback http target is NOT a legitimate handoff.
    expect(isSameOriginRedirect('http://evil.com/pay', ORIGIN)).toBe(true);
  });

  it('refuses the javascript: handoff (the CSP-only-by-accident hole)', () => {
    // Why the old code let this through: the URL parser reports origin 'null'.
    expect(new URL('javascript:alert(1)').origin).toBe('null');
    // 'null' never equals a real origin, so the old code returned false and
    // the call site assigned the javascript: URL into the address bar.
    expect(new URL('javascript:alert(1)').origin === ORIGIN).toBe(false);
    // The gate must NOT return the privileged answer for it.
    expect(isSameOriginRedirect('javascript:alert(1)', ORIGIN)).toBe(true);
    expect(isSameOriginRedirect('JaVaScRiPt:alert(1)', ORIGIN)).toBe(true);
    expect(isSameOriginRedirect('javascript:alert(document.cookie)', DEV_ORIGIN)).toBe(true);
  });

  it('refuses other non-http(s) schemes', () => {
    expect(isSameOriginRedirect('data:text/html,<script>alert(1)</script>', ORIGIN)).toBe(true);
    expect(isSameOriginRedirect('vbscript:msgbox(1)', ORIGIN)).toBe(true);
    expect(isSameOriginRedirect('file:///etc/passwd', ORIGIN)).toBe(true);
    expect(isSameOriginRedirect('blob:https://evil.com/uuid', ORIGIN)).toBe(true);
    expect(isSameOriginRedirect('about:blank', ORIGIN)).toBe(true);
  });

  it('refuses the protocol-relative and backslash forms the old startsWith short-circuit accepted', () => {
    // These are NOT in-app paths -- they resolve to a different origin.
    expect(new URL('//evil.com/pay', ORIGIN).href).toBe('https://evil.com/pay');
    expect(new URL('/\\evil.com/pay', ORIGIN).href).toBe('https://evil.com/pay');
    // They must not be granted the browser handoff. (The call site still has
    // its own `startsWith('/')` check that needs the same exclusion -- see the
    // KNOWN RESIDUAL note on isSameOriginRedirect.)
    expect(isSameOriginRedirect('//evil.com/pay', ORIGIN)).toBe(true);
    expect(isSameOriginRedirect('/\\evil.com/pay', ORIGIN)).toBe(true);
  });

  it('refuses anything unparseable or empty rather than falling through to a handoff', () => {
    expect(isSameOriginRedirect('', ORIGIN)).toBe(true);
    expect(isSameOriginRedirect('http://[bad', ORIGIN)).toBe(true);
    expect(isSameOriginRedirect(undefined as unknown as string, ORIGIN)).toBe(true);
    expect(isSameOriginRedirect(null as unknown as string, ORIGIN)).toBe(true);
  });

  it('never returns the privileged answer except for an allow-listed absolute scheme', () => {
    const hostile = [
      'javascript:alert(1)',
      'data:text/html,x',
      'vbscript:msgbox(1)',
      '//evil.com/pay',
      '/\\evil.com/pay',
      'http://evil.com/pay',
      'file:///etc/passwd',
      '',
    ];
    for (const url of hostile) {
      expect(isSameOriginRedirect(url, ORIGIN)).toBe(true);
    }
  });
});
