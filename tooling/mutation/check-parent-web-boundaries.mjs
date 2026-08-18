import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const failures = [];
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const visible = ['appUsage', 'webBrowsing', 'contentBlocks', 'location', 'screenTime', 'eyeProtection', 'prayerReminders', 'deviceStatus', 'policyChanges'];
const notVisible = ['messages', 'screenshots', 'biometrics', 'preciseWithoutConsent', 'fullBrowsing', 'thirdParty'];

function requireText(source, value, label) {
  if (!source.includes(value)) failures.push(`missing ${label}: ${value}`);
}

function keysFromSource(source, name) {
  const match = source.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`));
  return match ? [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]) : [];
}

const transparency = await read('src/pages/privacy/Transparency.tsx');
const app = await read('src/App.tsx');
const english = JSON.parse(await read('src/i18n/locales/en.json'));
const arabic = JSON.parse(await read('src/i18n/locales/ar.json'));

requireText(transparency, 'export default function Transparency()', 'valid Transparency function declaration');
const actualVisible = keysFromSource(transparency, 'VISIBLE_KEYS');
const actualNotVisible = keysFromSource(transparency, 'NOT_VISIBLE_KEYS');
if (JSON.stringify(actualVisible) !== JSON.stringify(visible)) failures.push('visible disclosure key set changed');
if (JSON.stringify(actualNotVisible) !== JSON.stringify(notVisible)) failures.push('not-visible disclosure key set changed');
requireText(transparency, 'VISIBLE_KEYS.map', 'visible disclosure rendering');
requireText(transparency, 'NOT_VISIBLE_KEYS.map', 'not-visible disclosure rendering');
requireText(transparency, "t('transparency.encryptionNote')", 'E2EE disclosure');
requireText(transparency, "t('transparency.sdkNote')", 'SDK disclosure');
requireText(app, "import Transparency from './pages/privacy/Transparency'", 'transparency import');
requireText(app, 'path="privacy/transparency" element={<Transparency />}', 'transparency route');

for (const [locale, data] of [['en', english], ['ar', arabic]]) {
  if (JSON.stringify(Object.keys(data.transparency.visible).sort()) !== JSON.stringify([...visible].sort())) failures.push(`${locale} visible locale keys changed`);
  if (JSON.stringify(Object.keys(data.transparency.notVisible).sort()) !== JSON.stringify([...notVisible].sort())) failures.push(`${locale} not-visible locale keys changed`);
}

for (const token of ['sendBeacon', 'navigator.sendBeacon', 'XMLHttpRequest', 'telemetry', 'analytics']) {
  if (transparency.toLowerCase().includes(token.toLowerCase())) failures.push(`hidden browser collection marker: ${token}`);
}

if (failures.length > 0) {
  console.error(JSON.stringify({ root, failures }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ root, status: 'PASS' }));
}
