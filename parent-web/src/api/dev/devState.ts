// Shared in-memory dev session state. Deliberately not persisted to any
// Web Storage (see src/security/secureStorage.ts) -- resets on reload,
// which is fine for a fixture-backed demo mode.
import type { FamilyRole } from '../../domain/roles';
import type { AuthenticatedSession } from '../interfaces';

const VALID_ROLES: readonly FamilyRole[] = ['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD'];

function initialDevRole(): FamilyRole {
  // Test-only convenience: a `?demoRole=VIEWER` query param lets Playwright
  // e2e tests preset the fixture role across a full page navigation (a real
  // browser reload resets this module's in-memory state, so switching role
  // via the header select and then calling page.goto() would otherwise lose
  // the selection). Only ever consulted in fixture/demo mode.
  if (typeof window !== 'undefined') {
    const requested = new URLSearchParams(window.location.search).get('demoRole');
    if (requested && (VALID_ROLES as string[]).includes(requested)) {
      return requested as FamilyRole;
    }
  }
  return 'OWNER';
}

type DevMfaState = 'ACTIVE' | 'GRACE' | 'SETUP_REQUIRED';

function initialDevMfa(): DevMfaState {
  // Test-only convenience, same rationale as `demoRole`: `?demoMfa=GRACE`
  // (or SETUP_REQUIRED) lets Playwright preset the authenticator status
  // across a full page navigation. Defaults to ACTIVE so the grace reminder
  // never appears in unrelated fixture journeys.
  if (typeof window !== 'undefined') {
    const requested = new URLSearchParams(window.location.search).get('demoMfa');
    if (requested === 'GRACE' || requested === 'SETUP_REQUIRED') return requested;
  }
  return 'ACTIVE';
}

let currentRole: FamilyRole = initialDevRole();
let serviceAuthenticated = true;
let devMfa: DevMfaState = initialDevMfa();
// Fixed once per page load, so the displayed time left counts down rather than resetting on every read.
const devGraceExpiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000).toISOString();

const listeners = new Set<() => void>();

export function subscribeDevState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((l) => l());
}

export function getDevRole(): FamilyRole {
  return currentRole;
}

export function setDevRole(role: FamilyRole): void {
  currentRole = role;
  notify();
}

export function getServiceAuthenticated(): boolean {
  return serviceAuthenticated;
}

export function setServiceAuthenticated(value: boolean): void {
  serviceAuthenticated = value;
  notify();
}

export function setDevMfa(value: DevMfaState): void {
  devMfa = value;
  notify();
}

export function buildDevSession(): AuthenticatedSession {
  return {
    accountId: 'dev-account-1',
    displayName: 'Dev Parent',
    familyId: 'dev-family-1',
    memberId:
      currentRole === 'OWNER'
        ? 'member-owner'
        : currentRole === 'ADMINISTRATOR'
          ? 'member-admin'
          : currentRole === 'VIEWER'
            ? 'member-viewer'
            : 'member-amir',
    role: currentRole,
    serviceAuthenticated,
    mfa: devMfa === 'ACTIVE' ? { status: 'ACTIVE' } : { status: devMfa, graceExpiresAt: devGraceExpiresAt },
  };
}
