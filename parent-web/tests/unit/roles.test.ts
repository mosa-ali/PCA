import { describe, expect, it } from 'vitest';
import {
  denialReasonCodeFromKey,
  denialReasonKey,
  evaluatePermission,
  nextStepKey,
  SAFE_DEFAULT_DELEGATION,
  type DenialReasonCode,
  type FamilyAction,
  type FamilyRole,
} from '../../src/domain/roles';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';

describe('evaluatePermission', () => {
  it('allows Owner to edit child policy without step-up', () => {
    const result = evaluatePermission('OWNER', 'EDIT_CHILD_POLICY');
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.requiresStepUp).toBe(false);
  });

  it('denies Viewer from editing child policy', () => {
    const result = evaluatePermission('VIEWER', 'EDIT_CHILD_POLICY');
    expect(result.allowed).toBe(false);
  });

  it('denies Child from editing child policy (request-only)', () => {
    const result = evaluatePermission('CHILD', 'EDIT_CHILD_POLICY');
    expect(result.allowed).toBe(false);
  });

  it('requires step-up for Owner adding an Administrator', () => {
    const result = evaluatePermission('OWNER', 'ADD_ADMINISTRATOR');
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.requiresStepUp).toBe(true);
  });

  it('denies Administrator from adding another Administrator or changing roles', () => {
    expect(evaluatePermission('ADMINISTRATOR', 'ADD_ADMINISTRATOR').allowed).toBe(false);
    expect(evaluatePermission('ADMINISTRATOR', 'CHANGE_ANY_ROLE').allowed).toBe(false);
  });

  it('denies Administrator from adding a Viewer by default (safe default delegation off)', () => {
    const result = evaluatePermission('ADMINISTRATOR', 'ADD_VIEWER', SAFE_DEFAULT_DELEGATION);
    expect(result.allowed).toBe(false);
  });

  it('allows Administrator to add a Viewer when Owner delegates it', () => {
    const result = evaluatePermission('ADMINISTRATOR', 'ADD_VIEWER', {
      administratorsCanManageViewers: true,
      administratorsCanRevokeDevices: false,
    });
    expect(result.allowed).toBe(true);
  });

  it('only Owner can transfer ownership or reveal recovery material, with step-up', () => {
    for (const role of ['ADMINISTRATOR', 'VIEWER', 'CHILD'] as const) {
      expect(evaluatePermission(role, 'TRANSFER_OWNERSHIP').allowed).toBe(false);
      expect(evaluatePermission(role, 'REVEAL_RECOVERY_MATERIAL').allowed).toBe(false);
    }
    const owner = evaluatePermission('OWNER', 'TRANSFER_OWNERSHIP');
    expect(owner.allowed).toBe(true);
    if (owner.allowed) expect(owner.requiresStepUp).toBe(true);
  });

  it('only Owner can change retention, delete history, or export by default', () => {
    for (const action of ['CHANGE_RETENTION', 'DELETE_HISTORY', 'EXPORT_DATA'] as const) {
      expect(evaluatePermission('OWNER', action).allowed).toBe(true);
      expect(evaluatePermission('ADMINISTRATOR', action).allowed).toBe(false);
      expect(evaluatePermission('VIEWER', action).allowed).toBe(false);
      expect(evaluatePermission('CHILD', action).allowed).toBe(false);
    }
  });

  it('allows a Child to create a request but not a parent role', () => {
    expect(evaluatePermission('CHILD', 'CREATE_CHILD_REQUEST').allowed).toBe(true);
    expect(evaluatePermission('OWNER', 'CREATE_CHILD_REQUEST').allowed).toBe(false);
  });

  describe('device enrollment actions (client-side UX heuristic only -- server AuthzService is authoritative)', () => {
    it('Owner and Administrator can view device enrollment status; Child cannot', () => {
      expect(evaluatePermission('OWNER', 'VIEW_DEVICE_ENROLLMENT').allowed).toBe(true);
      expect(evaluatePermission('ADMINISTRATOR', 'VIEW_DEVICE_ENROLLMENT').allowed).toBe(true);
      expect(evaluatePermission('VIEWER', 'VIEW_DEVICE_ENROLLMENT').allowed).toBe(true);
      expect(evaluatePermission('CHILD', 'VIEW_DEVICE_ENROLLMENT').allowed).toBe(false);
    });

    it('only Owner or Administrator can create a device invitation, with step-up required', () => {
      const owner = evaluatePermission('OWNER', 'CREATE_DEVICE_INVITATION');
      expect(owner.allowed).toBe(true);
      if (owner.allowed) expect(owner.requiresStepUp).toBe(true);
      expect(evaluatePermission('ADMINISTRATOR', 'CREATE_DEVICE_INVITATION').allowed).toBe(true);
      expect(evaluatePermission('VIEWER', 'CREATE_DEVICE_INVITATION').allowed).toBe(false);
      expect(evaluatePermission('CHILD', 'CREATE_DEVICE_INVITATION').allowed).toBe(false);
    });

    it('revoking an invitation or confirming pairing requires Owner, or a delegated Administrator', () => {
      for (const action of ['REVOKE_DEVICE_INVITATION', 'CONFIRM_DEVICE_PAIRING'] as const) {
        expect(evaluatePermission('OWNER', action).allowed).toBe(true);
        expect(evaluatePermission('VIEWER', action).allowed).toBe(false);
        expect(evaluatePermission('ADMINISTRATOR', action, {
          administratorsCanManageViewers: false,
          administratorsCanRevokeDevices: false,
        }).allowed).toBe(false);
        expect(evaluatePermission('ADMINISTRATOR', action, {
          administratorsCanManageViewers: false,
          administratorsCanRevokeDevices: true,
        }).allowed).toBe(true);
      }
    });
  });
});

const ROLES: FamilyRole[] = ['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD'];
const ACTIONS: FamilyAction[] = [
  'VIEW_DASHBOARD', 'EDIT_CHILD_POLICY', 'APPROVE_REQUEST', 'ADD_VIEWER', 'REMOVE_NON_OWNER_PARENT',
  'ADD_ADMINISTRATOR', 'CHANGE_ANY_ROLE', 'CHANGE_RETENTION', 'DELETE_HISTORY', 'EXPORT_DATA',
  'REMOVE_OR_REVOKE_DEVICE', 'DISABLE_PROTECTION_POLICY', 'TRANSFER_OWNERSHIP', 'REVEAL_RECOVERY_MATERIAL',
  'MANAGE_WELLBEING_MESSAGES', 'CREATE_CHILD_REQUEST', 'VIEW_DEVICE_ENROLLMENT', 'CREATE_DEVICE_INVITATION',
  'REVOKE_DEVICE_INVITATION', 'CONFIRM_DEVICE_PAIRING', 'VIEW_BILLING', 'REQUEST_DEVICE_INCREASE',
  'REQUEST_PARENT_MEMBER_INCREASE', 'MANAGE_PAYMENT_METHOD',
];

function lookup(locale: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, locale);
}

/**
 * B016: NotPermitted derives its "what to do next" line from
 * denialReasonCodeFromKey(reasonKey) + nextStepKey(code), rather than a
 * second copy of the denial switch. This proves that round trip is lossless
 * and resolves to real (and distinct) copy in both locales for EVERY
 * denial evaluatePermission can actually produce -- not just the handful
 * exercised by the component tests.
 */
describe('denialReasonCodeFromKey / nextStepKey (B016 "what to do next" support)', () => {
  it('round-trips denialReasonKey for every DenialReasonCode', () => {
    const codes: DenialReasonCode[] = [
      'CHILD_ONLY_REQUEST_ACTION', 'ROLE_NOT_RECOGNISED', 'VIEWER_READ_ONLY_POLICY', 'CHILD_CANNOT_EDIT_POLICY',
      'VIEWER_MANAGEMENT_NOT_DELEGATED', 'OWNER_OR_DELEGATED_ADMIN_ONLY_VIEWERS', 'OWNER_ONLY_STEP_UP',
      'OWNER_ONLY_RETENTION_DELETE_EXPORT', 'DEVICE_REVOCATION_NOT_DELEGATED', 'OWNER_OR_DELEGATED_ADMIN_ONLY_DEVICES',
      'ENROLLMENT_NOT_FOR_CHILD', 'OWNER_OR_ADMIN_ONLY_INVITE_DEVICE', 'INVITATION_REVOCATION_NOT_DELEGATED',
      'OWNER_OR_DELEGATED_ADMIN_ONLY_INVITATION', 'OWNER_ONLY_BILLING', 'UNRECOGNISED_ACTION',
    ];
    for (const code of codes) {
      expect(denialReasonCodeFromKey(denialReasonKey(code))).toBe(code);
    }
  });

  it('returns null for a key that is not one of this module\'s own denial keys', () => {
    expect(denialReasonCodeFromKey('some.other.key')).toBeNull();
    expect(denialReasonCodeFromKey('')).toBeNull();
  });

  it('every denial evaluatePermission can actually produce has a nextStepKey resolving to real, distinct copy in both locales', () => {
    let denials = 0;
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        const result = evaluatePermission(role, action);
        if (result.allowed) continue;
        denials += 1;
        const code = denialReasonCodeFromKey(result.reasonKey as string);
        expect(code, `${role}/${action} reasonKey did not round-trip`).not.toBeNull();
        const key = nextStepKey(code as DenialReasonCode);
        expect(typeof lookup(en, key), `en ${key}`).toBe('string');
        expect(typeof lookup(ar, key), `ar ${key}`).toBe('string');
        expect(lookup(ar, key), `ar ${key} must not be the English text`).not.toBe(lookup(en, key));
      }
    }
    expect(denials).toBeGreaterThan(20);
  });
});
