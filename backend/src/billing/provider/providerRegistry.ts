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

export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  register(provider: PaymentProvider): void {
    if (this.providers.has(provider.providerName)) throw new DuplicateProviderRegistrationError(provider.providerName);
    this.providers.set(provider.providerName, provider);
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
 */
export function createDefaultProviderRegistry(options: CreateDefaultProviderRegistryOptions = {}): PaymentProviderRegistry {
  const env = options.env ?? process.env;
  const registry = new PaymentProviderRegistry();
  if (env.NODE_ENV === 'test' || env.NODE_ENV === 'development') {
    const secretResolver = options.sandboxSecretResolver ?? new SandboxStaticSecretResolver(env.PCA_SANDBOX_WEBHOOK_SECRET);
    registry.register(createSandboxPaymentProvider(secretResolver, env));
  }
  return registry;
}
