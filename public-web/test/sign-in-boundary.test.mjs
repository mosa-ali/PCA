import assert from 'node:assert/strict';
import test from 'node:test';

import { renderPages } from '../build.mjs';
import { authHandoffHref, localAuthHandoffForPath } from '../src/config/handoffs.mjs';

function signInPages() {
  return renderPages('https://www.pcasafe.com').filter((page) => page.routeId === 'signIn');
}

test('Public Web sign-in remains a neutral chooser and never renders authentication controls', () => {
  const pages = signInPages();
  assert.equal(pages.length, 2, 'the chooser must be emitted once per locale');

  for (const page of pages) {
    assert.equal((page.html.match(/<form\b/gi) ?? []).length, 0, `${page.locale} must not own a login form`);
    assert.equal((page.html.match(/<input\b/gi) ?? []).length, 0, `${page.locale} must not own auth inputs`);
    assert.doesNotMatch(page.html, /type=["']password["']/i, `${page.locale} must not render password controls`);

    assert.equal((page.html.match(/href="\/parent\/login\/"/g) ?? []).length, 1);
    assert.equal((page.html.match(/href="\/platform-admin\/login\/"/g) ?? []).length, 1);
    assert.match(page.html, /data-auth-handoff="parent"[^>]*href="\/parent\/login\/"/);
    assert.match(page.html, /data-auth-handoff="platformAdmin"[^>]*href="\/platform-admin\/login\/"/);
  }
});

test('Public Web does not emit duplicate account-auth routes', () => {
  const pages = renderPages('https://www.pcasafe.com');
  const emittedPaths = new Set(pages.map((page) => page.path));
  for (const path of ['/login/index.html', '/signup/index.html', '/forgot-password/index.html', '/reset-password/index.html', '/verify-email/index.html']) {
    assert.equal(emittedPaths.has(path), false, `${path} must remain owned by its separate application`);
  }
});

test('auth handoffs are centrally configurable without changing the approved chooser paths', () => {
  assert.equal(authHandoffHref('parent', {}), '/parent/login/');
  assert.equal(authHandoffHref('platformAdmin', {}), '/platform-admin/login/');
  assert.equal(
    authHandoffHref('parent', { PUBLIC_PARENT_WEB_ORIGIN: 'https://app.pcasafe.com' }),
    'https://app.pcasafe.com/login/',
  );
  assert.equal(
    authHandoffHref('platformAdmin', { PUBLIC_PLATFORM_ADMIN_WEB_ORIGIN: 'https://admin.pcasafe.com' }),
    'https://admin.pcasafe.com/login/',
  );
  assert.equal(localAuthHandoffForPath('/parent/login/', {}), 'http://127.0.0.1:4000/login/');
  assert.equal(localAuthHandoffForPath('/platform-admin/login/', {}), 'http://127.0.0.1:4100/login/');
});
