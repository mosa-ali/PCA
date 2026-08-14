// In-memory-only Platform Administration session token store.
//
// This token grants operator authority over PCA's commercial/account back
// office (Section 4 of PCA_ADDENDUM_002 / PCA-ADD-PA-014's "dedicated
// session type" requirement). It MUST NEVER be written to localStorage,
// sessionStorage, a cookie, or any other persisted store: an admin session
// is deliberately lost on page reload, requiring fresh credentials + MFA,
// rather than surviving as a token an XSS or a shared/kiosk browser could
// exfiltrate. This is a stricter posture than a typical "remember me"
// consumer session by design (PCA-ADD-PA-016: no bypass of MFA at login).

interface StoredSession {
  token: string;
  expiresAt: string;
}

let current: StoredSession | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export const secureSession = {
  set(token: string, expiresAt: string): void {
    current = { token, expiresAt };
    notify();
  },
  get(): StoredSession | null {
    return current;
  },
  clear(): void {
    current = null;
    notify();
  },
  isExpired(): boolean {
    if (!current) return true;
    return new Date(current.expiresAt).getTime() <= Date.now();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
