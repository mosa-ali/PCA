/**
 * Resolve the owner-supplied Android distribution destination for the public
 * `/child-app/` landing page. An empty value keeps the page honest and the
 * Parent invitation gate closed; no store or package URL is inferred.
 */
export function resolveChildAppDistributionUrl(raw = process.env.PUBLIC_CHILD_APP_DISTRIBUTION_URL) {
  const value = (raw ?? '').trim();
  if (!value) return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('PUBLIC_CHILD_APP_DISTRIBUTION_URL must be an absolute HTTPS URL.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname === '::1' || hostname === '0.0.0.0' || /^127\./.test(hostname);
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password ||
      parsed.hash || parsed.port || loopback) {
    throw new Error('PUBLIC_CHILD_APP_DISTRIBUTION_URL must be public HTTPS without credentials, a fragment, a custom port, or a loopback host.');
  }

  return parsed.toString();
}
