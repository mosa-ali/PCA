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

function initialGenesisPending(): boolean {
  // Test-only convenience, same rationale as `demoRole`: a
  // `?demoGenesis=required` query param lets Playwright preset the pre-family
  // state across a full page navigation, so the genesis routing guard and
  // ceremony can be exercised in e2e instead of only on their success path.
  if (typeof window !== 'undefined') {
    return new URLSearchParams(window.location.search).get('demoGenesis') === 'required';
  }
  return false;
}

let currentRole: FamilyRole = initialDevRole();
let serviceAuthenticated = true;
let genesisPending = initialGenesisPending();

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

/** True while the dev fixture is modelling an authenticated account that has not yet created a family. */
export function getGenesisPending(): boolean {
  return genesisPending;
}

export function setGenesisPending(value: boolean): void {
  genesisPending = value;
  notify();
}

export function buildDevSession(): AuthenticatedSession {
  // An account that has authenticated but owns no family yet. The session must
  // say so EXPLICITLY rather than presenting null family fields behind a
  // FAMILY_READY-shaped object, which is what made the pre-family case
  // indistinguishable from a broken family scope.
  if (serviceAuthenticated && genesisPending) {
    return {
      state: 'GENESIS_REQUIRED',
      accountId: 'dev-account-1',
      displayName: 'Dev Parent',
      familyId: null,
      memberId: null,
      role: null,
      serviceAuthenticated: true,
      genesisAvailable: true,
    };
  }
  return {
    state: 'FAMILY_READY',
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
  };
}
