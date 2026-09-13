import { describe, expect, it } from 'vitest';

import { resolveApiBaseUrl } from '../../src/config/env';

describe('Parent Web API build configuration', () => {
  it('preserves the local-development fallback when configuration is absent', () => {
    expect(resolveApiBaseUrl(undefined, false)).toBe('http://localhost:4001');
    expect(resolveApiBaseUrl('   ', false)).toBe('http://localhost:4001');
  });

  it('continues to accept an explicitly configured local HTTP endpoint outside production', () => {
    expect(resolveApiBaseUrl('http://127.0.0.1:4001', false)).toBe('http://127.0.0.1:4001');
  });

  it('allows the explicit demo/test build path to retain its fixture-backed localhost endpoint', () => {
    expect(resolveApiBaseUrl('http://localhost:4001', false)).toBe('http://localhost:4001');
  });

  it('rejects a missing production API endpoint', () => {
    expect(() => resolveApiBaseUrl(undefined, true)).toThrow(/requires VITE_PCA_API_BASE_URL/);
    expect(() => resolveApiBaseUrl('  ', true)).toThrow(/requires VITE_PCA_API_BASE_URL/);
  });

  it('rejects HTTP in production even for a non-local hostname', () => {
    expect(() => resolveApiBaseUrl('http://api.pcasafe.com', true)).toThrow(/must use HTTPS/);
  });

  it.each([
    'https://localhost:4001',
    'https://api.localhost',
    'https://127.0.0.1:4001',
    'https://[::1]:4001',
    'https://0.0.0.0:4001',
  ])('rejects production loopback endpoint %s', (endpoint) => {
    expect(() => resolveApiBaseUrl(endpoint, true)).toThrow(/must not target localhost or a loopback address/);
  });

  it('accepts an explicit production HTTPS endpoint and removes trailing slashes', () => {
    expect(resolveApiBaseUrl('https://api.pcasafe.com///', true)).toBe('https://api.pcasafe.com');
  });
});
