import { describe, expect, it } from 'vitest';
import type { HtmlTagDescriptor } from 'vite';
import { buildCspContent, CSP_CONTENT, securityHeadersPlugin } from '../../vite/securityHeadersPlugin';

// securityHeadersPlugin() always defines transformIndexHtml as a plain
// function (see ../../vite/securityHeadersPlugin.ts) -- this narrow type
// lets the test call it directly without fighting Vite's broader
// IndexHtmlTransformHook union (function | { handler, order, enforce }).
type PlainTransformIndexHtml = () => HtmlTagDescriptor[];

function cspOf(plugin: ReturnType<typeof securityHeadersPlugin>): string {
  if (!plugin.transformIndexHtml) throw new Error('transformIndexHtml hook not found');
  const transform = plugin.transformIndexHtml as unknown as PlainTransformIndexHtml;
  const tag = transform().find((d) => d.attrs?.['http-equiv'] === 'Content-Security-Policy');
  return String(tag?.attrs?.content ?? '');
}

describe('securityHeadersPlugin (platform-admin)', () => {
  it('only applies during build, not during dev (dev needs the inline React Refresh preamble)', () => {
    const plugin = securityHeadersPlugin('');
    expect(plugin.apply).toBe('build');
  });

  it('emits a restrictive CSP with frame-ancestors none and object-src none', () => {
    // frame-ancestors is the point of this file for THIS app: every
    // refund/settlement/entitlement/role-grant mutation here is confirmed
    // behind a step-up prompt, which is exactly what clickjacking baits.
    expect(CSP_CONTENT).toContain("frame-ancestors 'none'");
    expect(CSP_CONTENT).toContain("object-src 'none'");
    expect(CSP_CONTENT).toContain("default-src 'self'");
    expect(CSP_CONTENT).toContain("script-src 'self'");
    expect(CSP_CONTENT).toContain("base-uri 'self'");
    expect(CSP_CONTENT).toContain("form-action 'self'");
    expect(CSP_CONTENT).not.toContain('unsafe-eval');
    // Inline style ATTRIBUTES only (style={{...}} in several pages); no
    // inline-script escape hatch is granted anywhere.
    expect(CSP_CONTENT).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("defaults connect-src to 'self' only -- this app is same-origin, unlike parent-web", () => {
    // src/config/env.ts's apiBaseUrl defaults to '' (relative/same-origin)
    // because the backend has no CORS layer. Copying parent-web's
    // http://localhost:4001 connect-src fallback here would widen every
    // production build's policy to an origin this app never calls.
    const policy = buildCspContent('');
    expect(policy).toContain("connect-src 'self'; frame-ancestors 'none'");
    expect(policy).not.toContain('localhost');
    expect(buildCspContent(undefined)).toBe(policy);
  });

  it('adds an explicitly configured absolute API origin -- exact origin, never a wildcard', () => {
    const policy = buildCspContent('https://admin-api.example.com/platform-admin');
    expect(policy).toContain("connect-src 'self' https://admin-api.example.com;");
    expect(policy).not.toContain('/platform-admin;');
    expect(policy).not.toContain('*');
  });

  it('ignores a value that is not an absolute http(s) URL rather than widening the policy', () => {
    const sameOrigin = buildCspContent('');
    expect(buildCspContent('   ')).toBe(sameOrigin);
    expect(buildCspContent('/platform-admin')).toBe(sameOrigin);
    expect(buildCspContent('javascript:alert(1)')).toBe(sameOrigin);
    expect(buildCspContent('not a url')).toBe(sameOrigin);
  });

  it('the transformIndexHtml hook emits both the CSP meta tag and a strict referrer policy', () => {
    const plugin = securityHeadersPlugin('');
    if (!plugin.transformIndexHtml) throw new Error('transformIndexHtml hook not found');
    const transform = plugin.transformIndexHtml as unknown as PlainTransformIndexHtml;
    const result = transform();
    const cspTag = result.find((d) => d.attrs?.['http-equiv'] === 'Content-Security-Policy');
    const referrerTag = result.find((d) => d.attrs?.name === 'referrer');
    expect(cspTag).toBeDefined();
    expect(referrerTag).toBeDefined();
    expect(referrerTag?.attrs?.content).toBe('strict-origin-when-cross-origin');
  });

  it('the injected policy tracks the build-time API base URL passed by vite.config.ts', () => {
    expect(cspOf(securityHeadersPlugin(''))).toContain("connect-src 'self';");
    expect(cspOf(securityHeadersPlugin('https://admin-api.example.com'))).toContain(
      "connect-src 'self' https://admin-api.example.com;",
    );
  });
});
