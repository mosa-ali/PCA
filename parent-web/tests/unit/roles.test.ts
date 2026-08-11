import { describe, expect, it } from 'vitest';
import { evaluatePermission, SAFE_DEFAULT_DELEGATION } from '../../src/domain/roles';

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
});
