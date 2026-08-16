/**
 * PCA-BILL-2A -- provider registry. Maps a provider-name string to a
 * `PaymentProvider` instance (providerContract.ts). Unknown/unconfigured
 * provider name FAILS CLOSED (`UnknownProviderError`) -- there is no
 * default provider a caller silently falls back to.
 *
 * Provider registration is by reference only: the registry's own read
 * surface (`resolve`, `listRegisteredProviderNames`) never exposes a
 * secret value -- adapters obtain their own secrets from a `SecretResolver`
 * (secretResolver.ts), never through this registry.
 */
import type { PaymentProvider } from '../providerContract.js';
import { createSandboxPaymentProvider } from './sandboxProvider.js';
import { SandboxStaticSecretResolver } from './secretResolver.js';
import type { SecretResolver } from './secretResolver.js';

export class UnknownProviderError extends Error {
  constructor(providerName: string) {
    super(`Unknown or unconfigured payment provider: ${providerName}`);
    this.name = 'UnknownProviderError';
  }
}

export class DuplicateProviderRegistrationError extends Error {
  constructor(providerName: string) {
    super(`Payment provider already registered: ${providerName}`);
    this.name = 'DuplicateProviderRegistrationError';
  }
}

/**
 * Writer73: defensive kill-switch for a hypothetical future real (non-sandbox) adapter. Today
 * `createDefaultProviderRegistry` only ever registers `TEST_SANDBOX`, and only in test/development
 * -- this error can never fire against current code paths. It exists so that WHENEVER a future
 * real provider adapter is wired in, it structurally cannot go live in production by accident
 * (e.g. a NODE_ENV misconfiguration, a copy-pasted registration call, a rushed PR) without a
 * human deliberately setting `PCA_PAYMENT_PROVIDER_PRODUCTION_ACTIVATION` to that exact provider
 * name first -- a separate, explicit act from merely deploying the code that registers it.
 */
export class PaymentProviderProductionActivationError extends Error {
  constructor(providerName: string) {
    super(
      `Refusing to activate payment provider "${providerName}" outside test/development: no ` +
        'matching PCA_PAYMENT_PROVIDER_PRODUCTION_ACTIVATION approval was set for this exact ' +
        'provider name. This is a deliberate production kill-switch, not a bug -- see ' +
        'providerRegistry.ts\'s own doc comment.',
    );
    this.name = 'PaymentProviderProductionActivationError';
  }
}

export interface PaymentProviderRegistryOptions {
  readonly env?: NodeJS.ProcessEnv;
  /**
   * When true, `register()` refuses (throws `PaymentProviderProductionActivationError`) any
   * provider name that is not explicitly production-activated whenever NODE_ENV is neither
   * 'test' nor 'development' -- see `isProductionActivationApproved`. Defaults to false so every
   * existing/ad-hoc registry (this codebase's own test suites construct `new
   * PaymentProviderRegistry()` freely, registering synthetic fake providers regardless of ambient
   * NODE_ENV) is completely unaffected. Only `createDefaultProviderRegistry`'s own registry (the
   * single sanctioned production composition root, per this file's own doc comment) opts in.
   */
  readonly enforceProductionActivationGate?: boolean;
}

export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();
  private readonly env: NodeJS.ProcessEnv;
  private readonly enforceProductionActivationGate: boolean;

  constructor(options: PaymentProviderRegistryOptions = {}) {
    this.env = options.env ?? process.env;
    this.enforceProductionActivationGate = options.enforceProductionActivationGate ?? false;
  }

  register(provider: PaymentProvider): void {
    if (this.providers.has(provider.providerName)) throw new DuplicateProviderRegistrationError(provider.providerName);
    if (this.enforceProductionActivationGate && !this.isProductionActivationApproved(provider.providerName)) {
      throw new PaymentProviderProductionActivationError(provider.providerName);
    }
    this.providers.set(provider.providerName, provider);
  }

  /** test/development always passes (this is where TEST_SANDBOX legitimately registers itself
   * today, and where a real provider's own integration tests would run). Any other environment
   * requires an operator to have explicitly set
   * PCA_PAYMENT_PROVIDER_PRODUCTION_ACTIVATION=<exact provider name> -- never a boolean flag,
   * so approving one provider can never accidentally also approve a different one. */
  private isProductionActivationApproved(providerName: string): boolean {
    const nodeEnv = this.env.NODE_ENV;
    if (nodeEnv === 'test' || nodeEnv === 'development') return true;
    return this.env.PCA_PAYMENT_PROVIDER_PRODUCTION_ACTIVATION === providerName;
  }

  /** Fails closed: throws UnknownProviderError for anything not explicitly registered -- never a default/fallback provider. */
  resolve(providerName: string): PaymentProvider {
    const provider = this.providers.get(providerName);
    if (!provider) throw new UnknownProviderError(providerName);
    return provider;
  }

  isRegistered(providerName: string): boolean {
    return this.providers.has(providerName);
  }

  listRegisteredProviderNames(): string[] {
    return [...this.providers.keys()];
  }
}

export interface CreateDefaultProviderRegistryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly sandboxSecretResolver?: SecretResolver;
}

/**
 * The application's single provider-registry bootstrap point (buildServer/
 * main.ts wiring calls this, never `new PaymentProviderRegistry()` +
 * ad-hoc registration scattered elsewhere).
 *
 * TEST_SANDBOX is registered ONLY when NODE_ENV is 'test' or 'development'
 * -- this check is deliberately duplicated with (not merely delegated to)
 * createSandboxPaymentProvider's own internal gate: even if a future edit
 * to this function's conditional were wrong, the sandbox adapter's factory
 * would still independently refuse to construct outside those two
 * environments, so a bug here can never silently open a production sandbox
 * provider.
 *
 * PAYMENT_PROVIDER_SELECTION (Section 19.2) is this codebase's external
 * commercial gate for registering any real/production provider -- this
 * function registers nothing else. In production (NODE_ENV neither 'test'
 * nor 'development'), the returned registry is EMPTY: every
 * checkout/webhook/refund call that tries to resolve a provider fails
 * closed with UnknownProviderError, rather than silently using the sandbox
 * or any other default.
 *
 * Writer73: this registry is constructed with `enforceProductionActivationGate: true` -- the
 * production kill-switch (`PaymentProviderProductionActivationError`) for whatever a FUTURE real
 * provider registration is added here. It is inert today: the only `register()` call below is
 * already conditioned on the same test/development check `isProductionActivationApproved`
 * short-circuits on, so this gate never fires against current code -- it only guards against a
 * later edit to this function forgetting the equivalent care this one already takes.
 */
export function createDefaultProviderRegistry(options: CreateDefaultProviderRegistryOptions = {}): PaymentProviderRegistry {
  const env = options.env ?? process.env;
  const registry = new PaymentProviderRegistry({ env, enforceProductionActivationGate: true });
  if (env.NODE_ENV === 'test' || env.NODE_ENV === 'development') {
    const secretResolver = options.sandboxSecretResolver ?? new SandboxStaticSecretResolver(env.PCA_SANDBOX_WEBHOOK_SECRET);
    registry.register(createSandboxPaymentProvider(secretResolver, env));
  }
  return registry;
}
