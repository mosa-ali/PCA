// Secure storage abstraction. Family private keys / secrets (e.g. a
// trusted-browser device signing key) MUST NEVER be placed in
// localStorage, sessionStorage, cookies, or logs -- see
// docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 7.
//
// Production needs a real secure-enclave/keystore-backed approach (analogous
// to Android Keystore / iOS Keychain, but for a browser -- e.g. a
// non-extractable WebCrypto CryptoKey held only in memory / IndexedDB with
// `extractable: false`). This module is a dev-only in-memory stub that is
// intentionally NOT persisted across reloads, so it can never accidentally
// leak into a real persistent store.

export interface SecureKeyHandle {
  keyId: string;
  /** Opaque -- never the raw key material. Present only for dev-stub display/debug. */
  label: string;
}

export interface SecureStorage {
  /** Stores a value in memory only. Never touches Web Storage or disk. */
  putSecret(keyId: string, value: unknown): Promise<SecureKeyHandle>;
  hasSecret(keyId: string): Promise<boolean>;
  /** Intentionally does not expose a generic "getSecret" -- callers must use a scoped accessor. */
  clear(keyId: string): Promise<void>;
  clearAll(): Promise<void>;
}

class InMemorySecureStorage implements SecureStorage {
  private store = new Map<string, unknown>();

  async putSecret(keyId: string, value: unknown): Promise<SecureKeyHandle> {
    this.store.set(keyId, value);
    return { keyId, label: `dev-memory:${keyId}` };
  }

  async hasSecret(keyId: string): Promise<boolean> {
    return this.store.has(keyId);
  }

  async clear(keyId: string): Promise<void> {
    this.store.delete(keyId);
  }

  async clearAll(): Promise<void> {
    this.store.clear();
  }
}

/**
 * Dev-mode secure storage singleton. PRODUCTION_NOTE: replace with a real
 * keystore-backed implementation (non-extractable WebCrypto keys or a
 * platform-provided secure enclave bridge) before any real family key
 * material is handled.
 */
export const secureStorage: SecureStorage = new InMemorySecureStorage();
