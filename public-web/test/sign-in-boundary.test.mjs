import assert from 'node:assert/strict';
import test from 'node:test';

import { renderPages } from '../build.mjs';
import { authHandoffHref, localAuthHandoffForPath, parentRegistrationHref } from '../src/config/handoffs.mjs';

function signInPages() {
  return renderPages('https://www.pcasafe.com').filter((page) => page.routeId === 'signIn');
}

test('Public Web sign-in is Parent-focused and never renders authentication controls', () => {
  const pages = signInPages();
  assert.equal(pages.length, 2, 'the Parent sign-in page must be emitted once per locale');

  for (const page of pages) {
    assert.equal((page.html.match(/<form\b/gi) ?? []).length, 0, `${page.locale} must not own a login form`);
    assert.equal((page.html.match(/<input\b/gi) ?? []).length, 0, `${page.locale} must not own auth inputs`);
    assert.doesNotMatch(page.html, /type=["']password["']/i, `${page.locale} must not render password controls`);

    assert.equal((page.html.match(/data-auth-handoff="parent"/g) ?? []).length, 1);
    assert.match(page.html, /data-auth-handoff="parent"[^>]*href="https:\/\/parent\.pcasafe\.com\/login\/"/);
    assert.match(page.html, /href="https:\/\/parent\.pcasafe\.com\/register\/"/);
    assert.doesNotMatch(page.html, /platform-admin|Platform Admin|منصة الإدارة/i);
  }
});

test('Public Web does not emit duplicate account-auth routes', () => {
  const pages = renderPages('https://www.pcasafe.com');
  const emittedPaths = new Set(pages.map((page) => page.path));
  for (const path of ['/login/index.html', '/signup/index.html', '/forgot-password/index.html', '/reset-password/index.html', '/verify-email/index.html']) {
    assert.equal(emittedPaths.has(path), false, `${path} must remain owned by its separate application`);
  }
});

test('auth handoffs are centrally configurable with dedicated application origins', () => {
  assert.equal(authHandoffHref('parent', {}), 'https://parent.pcasafe.com/login/');
  assert.equal(authHandoffHref('platformAdmin', {}), 'https://platform.pcasafe.com/login/');
  assert.equal(parentRegistrationHref({}), 'https://parent.pcasafe.com/register/');
  assert.equal(
    authHandoffHref('parent', { PUBLIC_PARENT_WEB_ORIGIN: 'https://app.pcasafe.com' }),
    'https://app.pcasafe.com/login/',
  );
  assert.equal(
    authHandoffHref('platformAdmin', { PUBLIC_PLATFORM_ADMIN_WEB_ORIGIN: 'https://admin.pcasafe.com' }),
    'https://admin.pcasafe.com/login/',
  );
  assert.equal(
    parentRegistrationHref({ PUBLIC_PARENT_WEB_ORIGIN: 'https://app.pcasafe.com' }),
    'https://app.pcasafe.com/register/',
  );
  assert.equal(localAuthHandoffForPath('/parent/login/', {}), 'http://127.0.0.1:4000/login/');
  assert.equal(localAuthHandoffForPath('/platform-admin/login/', {}), 'http://127.0.0.1:4100/login/');
});
