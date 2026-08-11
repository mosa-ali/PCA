// Shared in-memory dev session state. Deliberately not persisted to any
// Web Storage (see src/security/secureStorage.ts) -- resets on reload,
// which is fine for a fixture-backed demo mode.
import type { FamilyRole } from '../../domain/roles';
import type { AuthenticatedSession } from '../interfaces';

let currentRole: FamilyRole = 'OWNER';
let serviceAuthenticated = true;

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
  };
}
