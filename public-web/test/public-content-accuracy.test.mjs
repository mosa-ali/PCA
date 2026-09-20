import assert from 'node:assert/strict';
import test from 'node:test';

import { renderPages } from '../build.mjs';

const pages = renderPages('https://www.pcasafe.com');
const byRoute = (routeId, locale) => pages.find((page) => page.routeId === routeId && page.locale === locale)?.html ?? '';

test('How It Works describes live Parent account access without releasing Child apps', () => {
  for (const locale of ['en', 'ar']) {
    const html = byRoute('howItWorks', locale);
    assert.ok(html, `${locale} How It Works page must render`);
    assert.doesNotMatch(html, /not open for new accounts|account creation.*later release|إنشاء حسابات جديدة بعد|إنشاء الحساب.*إصدار لاحق/i);
    assert.match(html, /email|البريد الإلكتروني/i);
    assert.match(html, /child-device protection workflows are still being completed|مسارات حماية أجهزة الأطفال قيد الاستكمال/i);
  }
});

test('Download represents Parent Web as online and never invents Child downloads', () => {
  for (const locale of ['en', 'ar']) {
    const html = byRoute('download', locale);
    assert.match(html, /Available online|متاح عبر الإنترنت/);
    assert.match(html, /https:\/\/parent\.pcasafe\.com\/login\//);
    assert.match(html, /https:\/\/parent\.pcasafe\.com\/register\//);
    assert.match(html, /not released yet|لم يُطلَق/);
    assert.doesNotMatch(html, /play\.google\.com|apps\.apple\.com|itunes\.apple\.com|\.apk\b|\.ipa\b|\.aab\b/i);
  }
});

test('Every public page keeps Platform Admin out of customer navigation', () => {
  for (const page of pages) {
    const navigation = page.html.match(/<header[\s\S]*?<\/header>/i)?.[0] ?? '';
    assert.doesNotMatch(navigation, /platform-admin|Platform Admin|منصة الإدارة/i, `${page.locale} ${page.routeId}`);
  }
});
