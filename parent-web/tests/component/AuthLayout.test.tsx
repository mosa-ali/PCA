import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { PcaApiClients } from '../../src/api/client';
import { renderWithProviders } from '../utils/renderWithProviders';
import { AuthLayout } from '../../src/components/auth/AuthLayout';
import Login from '../../src/pages/auth/Login';
import i18n, { applyDocumentDirection } from '../../src/i18n';

// The language switcher has always existed -- but only inside the
// AUTHENTICATED family-console Header (see components/shell/Header.tsx). None
// of the auth screens render that header, so the control was unreachable on
// exactly the screens a new parent meets first: registration, verification,
// login, login step-up, password reset and authenticator setup all had to be
// negotiated in whatever language the browser detected, with no way out until
// after signing in.
//
// These tests pin the two properties that make the fix safe rather than merely
// present: the control is reachable BEFORE a session exists, and switching
// language does not remount the page underneath it. The second one is not
// cosmetic -- authenticator setup holds its one-time enrollment secret in
// memory only (it is never persisted), so a remount or reload on that step
// discards it and restarts the setup.
//
// getApiClients() is mocked wholesale, the same technique
// tests/component/LoginStepUp.test.tsx uses for its own otherwise-unreachable
// state, because the dev ServiceAuth fixture does not model these pages.
vi.mock('../../src/api/client', () => ({
  getApiClients: () =>
    ({
      serviceAuth: {
        getSession: vi.fn().mockResolvedValue(null),
        signIn: vi.fn(),
        completeLoginStepUp: vi.fn(),
      },
      isFixtureBacked: false,
    }) as unknown as PcaApiClients,
}));

// The SAME nesting App.tsx uses for the auth surface: the layout route wraps
// the page. Asserting the page renders *through* the layout is the part that
// would silently rot if someone moved a route back out of AuthLayout.
function renderAuthRoute(path: string) {
  return renderWithProviders(
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<Login />} />
      </Route>
    </Routes>,
    { route: path },
  );
}

describe('Authentication surface language control', () => {
  const assignMock = vi.fn();

  beforeEach(async () => {
    assignMock.mockReset();
    // jsdom's `window.location.assign` cannot be spied on directly
    // (non-configurable) -- the standard workaround is to replace the whole
    // `location` object, as LoginStepUp.test.tsx does.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: assignMock },
    });
    // i18n is a module-level singleton shared by every test in this file, so a
    // language chosen by one test would otherwise leak into the next.
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('is reachable on an auth route, before any session exists', async () => {
    renderAuthRoute('/login');

    // The page itself rendered through the layout...
    expect(await screen.findByLabelText(i18n.t('auth.emailLabel'))).toBeInTheDocument();
    // ...and carries the control, named as a group so a screen reader says what
    // the pair of buttons is for.
    expect(screen.getByRole('group', { name: i18n.t('shell.language') })).toBeInTheDocument();
    // Both options are present and the current one is marked, so the control
    // states which language is active rather than only offering a choice.
    expect(screen.getByRole('button', { name: i18n.t('shell.languageArabic') })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: i18n.t('shell.languageEnglish') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('switches language without remounting the page: the entered email survives in the same element', async () => {
    renderAuthRoute('/login');

    const emailField = await screen.findByLabelText(i18n.t('auth.emailLabel'));
    await userEvent.type(emailField, 'parent@example.test');

    await userEvent.click(screen.getByRole('button', { name: i18n.t('shell.languageArabic') }));

    // Identity, not just value: the SAME input node is still mounted. A value
    // assertion alone would still pass if React had swapped in a fresh input
    // that happened to be re-populated from state, which is exactly the
    // remount this test exists to rule out.
    const afterSwitch = screen.getByLabelText(i18n.t('auth.emailLabel'));
    expect(afterSwitch).toBe(emailField);
    expect(afterSwitch).toHaveValue('parent@example.test');
  });

  it('applies document direction and does not navigate or reload', async () => {
    renderAuthRoute('/login');

    await screen.findByLabelText(i18n.t('auth.emailLabel'));
    await userEvent.click(screen.getByRole('button', { name: i18n.t('shell.languageArabic') }));

    expect(document.documentElement.dir).toBe('rtl');
    expect(i18n.language).toBe('ar');
    // No navigation: a half-finished setup and any half-typed form must survive a
    // language change, so this control may never move the parent.
    expect(assignMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: i18n.t('shell.languageEnglish') }));

    expect(document.documentElement.dir).toBe('ltr');
    expect(assignMock).not.toHaveBeenCalled();
  });
});
