/**
 * PCA-BILL-2A -- provider secret-resolution boundary.
 *
 * A provider adapter (e.g. the TEST_SANDBOX adapter in sandboxProvider.ts)
 * never reads a signing/API secret directly from an environment variable,
 * a config file, or a database column itself -- it asks a `SecretResolver`
 * for it by an opaque `secretRef`. This indirection is the seam a real
 * production adapter (out of scope here, gated by PAYMENT_PROVIDER_SELECTION,
 * Section 19.2) would use to inject a real secrets-manager-backed resolver
 * (AWS Secrets Manager, GCP Secret Manager, Vault, etc.) without any
 * provider-adapter code change -- this interface is deliberately never
 * shaped in a way that assumes plaintext-in-DB or plaintext-in-git storage
 * (no "store the secret value" method exists here, only "resolve a
 * reference to a value").
 */
export interface SecretResolver {
  resolve(secretRef: string): Promise<string>;
}

export class UnresolvedSecretError extends Error {
  constructor(secretRef: string) {
    super(`No secret is resolvable for reference: ${secretRef}`);
    this.name = 'UnresolvedSecretError';
  }
}

/**
 * SANDBOX_ONLY: a fixed, clearly-test-only signing secret used exclusively
 * by the TEST_SANDBOX provider adapter (sandboxProvider.ts), which itself
 * refuses to construct outside NODE_ENV=test|development (see
 * createSandboxPaymentProvider). Never used by, or reachable from, any
 * production code path -- there is no production adapter in this lane at
 * all (providerContract.ts has no other implementation).
 *
 * Overridable via PCA_SANDBOX_WEBHOOK_SECRET purely so tests can exercise
 * distinct secrets/rotation scenarios without editing this source file.
 */
const SANDBOX_ONLY_DEFAULT_TEST_SECRET = 'sandbox-only-test-signing-secret-do-not-use-in-production';
const SANDBOX_ONLY_SECRET_REF = 'TEST_SANDBOX_WEBHOOK_SIGNING_SECRET';

export class SandboxStaticSecretResolver implements SecretResolver {
  constructor(private readonly envValue: string | undefined = process.env.PCA_SANDBOX_WEBHOOK_SECRET) {}

  async resolve(secretRef: string): Promise<string> {
    if (secretRef !== SANDBOX_ONLY_SECRET_REF) throw new UnresolvedSecretError(secretRef);
    return this.envValue ?? SANDBOX_ONLY_DEFAULT_TEST_SECRET;
  }
}

export { SANDBOX_ONLY_SECRET_REF };
