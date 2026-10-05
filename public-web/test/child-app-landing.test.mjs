import assert from 'node:assert/strict';
import test from 'node:test';

import { CONTENT } from '../src/content/index.mjs';
import { resolveChildAppDistributionUrl } from '../src/config/childAppDistribution.mjs';
import { render } from '../src/pages/childApp.mjs';

const origin = 'https://www.pcasafe.com';
const built = new Set(['home', 'howItWorks', 'privacy', 'download', 'contact', 'accessibility', 'privacyPolicy', 'terms', 'signIn', 'childApp']);

function page(locale, childAppDistributionUrl = null) {
  const t = (key) => CONTENT[locale][key];
  return render({
    locale,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    routeId: 'childApp',
    origin,
    childAppDistributionUrl,
    t,
    built,
  });
}

test('Child App landing stays truthful without a configured release destination', () => {
  assert.equal(resolveChildAppDistributionUrl(''), null);
  for (const locale of ['en', 'ar']) {
    const html = page(locale);
    assert.match(html, /name="robots" content="noindex, nofollow"/);
    assert.match(html, /<h1[^>]*>.*<\/h1>/s);
    assert.doesNotMatch(html, /<a[^>]+(?:\.apk|play\.google\.com|apps\.apple\.com)/i);
    assert.doesNotMatch(html, /approved Android app distribution destination/i);
  }
  assert.match(page('en'), /Current installation availability and options for the PCA Child Android app\./);
  assert.match(page('ar'), /معلومات عن مدى توفر تثبيت تطبيق حماية الطفل على أندرويد وخياراته/);
  assert.match(page('en'), /No approved Android installation destination is configured here\./);
  assert.match(page('ar'), /لم تُضبط هنا وجهة معتمدة لتثبيت التطبيق على أندرويد/);
});

test('Child App landing accepts only public HTTPS distribution destinations', () => {
  const storeUrl = 'https://play.google.com/store/apps/details?id=org.pca.app';
  const landingUrl = 'https://distribution.example.test/pca-child';
  assert.equal(resolveChildAppDistributionUrl(storeUrl), storeUrl);
  assert.equal(resolveChildAppDistributionUrl(landingUrl), landingUrl);
  assert.throws(() => resolveChildAppDistributionUrl('http://downloads.example.test/app.apk'), /HTTPS/);
  assert.throws(() => resolveChildAppDistributionUrl('https://user:pass@downloads.example.test/app.apk'), /credentials/);
  assert.throws(() => resolveChildAppDistributionUrl('https://localhost/app.apk'), /loopback/);
  assert.throws(() => resolveChildAppDistributionUrl('https://downloads.example.test:8443/app.apk'), /custom port/);
  assert.throws(() => resolveChildAppDistributionUrl('https://downloads.example.test/app.apk#latest'), /fragment/);

  const html = page('en', storeUrl);
  assert.match(html, /href="https:\/\/play\.google\.com\/store\/apps\/details\?id=org\.pca\.app"/);
  assert.match(html, /Continue to the approved app destination/);
  assert.match(html, /Check the current installation availability for PCA Child on Android here\./);
  assert.match(page('en', landingUrl), /href="https:\/\/distribution\.example\.test\/pca-child"/);
});
