import { describe, expect, it } from 'vitest';
import type { HtmlTagDescriptor } from 'vite';
import { CSP_CONTENT, securityHeadersPlugin } from '../../vite/securityHeadersPlugin';

// securityHeadersPlugin() always defines transformIndexHtml as a plain
// function (see ../../vite/securityHeadersPlugin.ts) -- this narrow type
// lets the test call it directly without fighting Vite's broader
// IndexHtmlTransformHook union (function | { handler, order, enforce }).
type PlainTransformIndexHtml = () => HtmlTagDescriptor[];

describe('securityHeadersPlugin', () => {
  it('only applies during build, not during dev (dev needs the inline React Refresh preamble)', () => {
    const plugin = securityHeadersPlugin();
    expect(plugin.apply).toBe('build');
  });

  it('injects a restrictive CSP with frame-ancestors none and object-src none', () => {
    expect(CSP_CONTENT).toContain("frame-ancestors 'none'");
    expect(CSP_CONTENT).toContain("object-src 'none'");
    expect(CSP_CONTENT).toContain("default-src 'self'");
    // connect-src stays explicit and includes the checked-in local API origin.
    expect(CSP_CONTENT).toContain("connect-src 'self'");
    expect(CSP_CONTENT).toContain('http://localhost:4001');
    expect(CSP_CONTENT).not.toContain('unsafe-eval');
  });

  it('the transformIndexHtml hook emits both the CSP meta tag and a strict referrer policy', () => {
    const plugin = securityHeadersPlugin();
    if (!plugin.transformIndexHtml) throw new Error('transformIndexHtml hook not found');
    const transform = plugin.transformIndexHtml as unknown as PlainTransformIndexHtml;
    const result = transform();
    const cspTag = result.find((d) => d.attrs?.['http-equiv'] === 'Content-Security-Policy');
    const referrerTag = result.find((d) => d.attrs?.name === 'referrer');
    expect(cspTag).toBeDefined();
    expect(referrerTag).toBeDefined();
    expect(referrerTag?.attrs?.content).toBe('strict-origin-when-cross-origin');
  });
});
