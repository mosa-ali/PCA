// PCA-FR-111: the RBAC denial sentences lived as English string literals in
// domain/roles.ts and were rendered verbatim -- as the PermissionGate tooltip
// and as the explanation on /not-permitted -- so an Arabic parent read English.
// They are now i18n keys in the same `rbac.*` namespace RolesMatrix and
// NotPermitted already use; the English literals survive only as the
// developer-facing `reason` diagnostic on the thrown Error.
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { setDevRole } from '../../src/api/dev/devState';
import { PermissionGate } from '../../src/rbac/PermissionGate';
import NotPermitted from '../../src/pages/NotPermitted';
import { evaluatePermission, type FamilyAction, type FamilyRole } from '../../src/domain/roles';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';

const ROLES: FamilyRole[] = ['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD'];
const ACTIONS: FamilyAction[] = [
  'VIEW_DASHBOARD',
  'EDIT_CHILD_POLICY',
  'APPROVE_REQUEST',
  'ADD_VIEWER',
  'REMOVE_NON_OWNER_PARENT',
  'ADD_ADMINISTRATOR',
  'CHANGE_ANY_ROLE',
  'CHANGE_RETENTION',
  'DELETE_HISTORY',
  'EXPORT_DATA',
  'REMOVE_OR_REVOKE_DEVICE',
  'DISABLE_PROTECTION_POLICY',
  'TRANSFER_OWNERSHIP',
  'REVEAL_RECOVERY_MATERIAL',
  'MANAGE_WELLBEING_MESSAGES',
  'CREATE_CHILD_REQUEST',
  'VIEW_DEVICE_ENROLLMENT',
  'CREATE_DEVICE_INVITATION',
  'REVOKE_DEVICE_INVITATION',
  'CONFIRM_DEVICE_PAIRING',
  'VIEW_BILLING',
  'REQUEST_DEVICE_INCREASE',
  'REQUEST_PARENT_MEMBER_INCREASE',
  'MANAGE_PAYMENT_METHOD',
];

function lookup(locale: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, locale);
}

describe('every RBAC denial carries a translated reason key', () => {
  it('produces a reasonKey that resolves in BOTH locales for every denied (role, action) pair', () => {
    let denials = 0;
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        const result = evaluatePermission(role, action);
        if (result.allowed) continue;
        denials += 1;
        expect(result.reasonKey, `${role}/${action} has no reasonKey`).toBeTruthy();
        const key = result.reasonKey as string;
        expect(key.startsWith('rbac.denialReason.'), key).toBe(true);
        expect(typeof lookup(en, key), `en ${key}`).toBe('string');
        expect(typeof lookup(ar, key), `ar ${key}`).toBe('string');
        expect(lookup(ar, key), `ar ${key} must not be the English text`).not.toBe(lookup(en, key));
      }
    }
    expect(denials).toBeGreaterThan(20);
  });
});

function renderWith(ui: ReactElement, initialEntries: Parameters<typeof MemoryRouter>[0]['initialEntries']) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={initialEntries}>
        <AuthProvider>
          <StepUpProvider>{ui}</StepUpProvider>
        </AuthProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('denial copy the parent actually sees is localized', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
    setDevRole('OWNER');
  });

  it("PermissionGate's disabled-fallback tooltip is Arabic under the Arabic locale", async () => {
    await i18n.changeLanguage('ar');
    setDevRole('VIEWER');
    const { container } = renderWith(
      <PermissionGate action="EDIT_CHILD_POLICY" showDisabledFallback>
        <button type="button">edit</button>
      </PermissionGate>,
      ['/'],
    );

    const title = container.querySelector('.permission-disabled')?.getAttribute('title') ?? '';
    expect(title).toBe(ar.rbac.denialReason.VIEWER_READ_ONLY_POLICY);
    expect(title).not.toBe(en.rbac.denialReason.VIEWER_READ_ONLY_POLICY);
    expect(title).toMatch(/\p{Script=Arabic}/u);
  });

  it('/not-permitted shows the Arabic denial reason, not the English diagnostic RouteGuard forwarded', async () => {
    await i18n.changeLanguage('ar');
    setDevRole('VIEWER');
    const denial = evaluatePermission('VIEWER', 'EDIT_CHILD_POLICY');
    expect(denial.allowed).toBe(false);
    const englishDiagnostic = denial.allowed ? '' : denial.reason;

    renderWith(
      <Routes>
        <Route path="/not-permitted" element={<NotPermitted />} />
      </Routes>,
      [
        {
          pathname: '/not-permitted',
          state: { from: '/children/child-amir/screen-time', reason: englishDiagnostic, action: 'EDIT_CHILD_POLICY' },
        },
      ],
    );

    expect(await screen.findByText(ar.rbac.denialReason.VIEWER_READ_ONLY_POLICY)).toBeInTheDocument();
    expect(screen.queryByText(englishDiagnostic)).not.toBeInTheDocument();
  });
});
