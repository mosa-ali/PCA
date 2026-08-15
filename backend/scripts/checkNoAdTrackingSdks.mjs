#!/usr/bin/env node
/**
 * PCA-FR-123 (Writer65): CI-runnable no-ads/no-data-broker SDK inventory
 * check. Fails (exit 1) if a known ad-tracking/cross-app-correlation SDK
 * (an ad-network mediation SDK, an ad-attribution/install-tracking SDK, or
 * a cross-app device-graph/data-broker SDK) has been added to any real
 * dependency manifest in this repository:
 *   - backend/package.json (dependencies + devDependencies)
 *   - platform-admin-web/package.json (dependencies + devDependencies)
 *   - android/app/build.gradle.kts, android/build.gradle.kts (raw
 *     `group:artifact` coordinate strings)
 *   - android/gradle/libs.versions.toml (the `module = "group:artifact"`
 *     entries the Gradle version catalog actually resolves)
 *
 * The blocklist below is real, named ad-network/attribution/data-broker
 * SDK package coordinates (AdMob/Google Ads Mediation, Meta Audience
 * Network, AppsFlyer, Adjust, AppLovin, Vungle/Liftoff, Chartboost,
 * ironSource/Unity LevelPlay, Unity Ads, MoPub, Mintegral, Pangle,
 * Tapjoy, Kochava, Branch's ad-attribution surface) -- it deliberately
 * does NOT include general first-party product-analytics SDKs (which are
 * a separate consent/scope decision, PCA-NFR-014), only SDKs whose entire
 * purpose is ad serving or cross-app/cross-device identity correlation.
 *
 * This script adds NO new dependency to the toolchain -- plain Node.js
 * fs/path only, matching PCA-NFR-006's "check what's actually installed
 * before adding a new external dependency" discipline.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Package-name (npm) and Gradle group-id fragments. Matched as
// case-insensitive substrings against dependency KEYS/coordinates only
// (never against unrelated prose), so a match is a real, named SDK
// reference, not a coincidental word.
const BLOCKED_SDK_PATTERNS = [
  // Ad-network mediation / ad-serving SDKs
  'com.google.android.gms:play-services-ads',
  'com.google.android.ads.mediationtestsuite',
  'react-native-google-mobile-ads',
  'react-native-admob',
  'expo-ads-admob',
  'react-native-fbads',
  'com.facebook.android:audience-network-sdk',
  'com.applovin:applovin-sdk',
  'applovin-max-react-native',
  'com.vungle:publisher-sdk-android',
  'react-native-vungle-ads',
  'com.chartboost.sdk',
  'com.ironsource.sdk',
  'react-native-ironsource',
  'com.unity3d.ads:unity-ads',
  'react-native-unity-ads',
  'com.mopub:mopub-sdk',
  'react-native-mopub',
  'com.mbridge.msdk',
  'com.pangle.global',
  'com.bytedance.sdk:openadsdk',
  'com.tapjoy:tapjoy-android-sdk',
  // Ad-attribution / install-tracking / cross-app device-graph SDKs
  'com.appsflyer:af-android-sdk',
  'appsflyer-react-native-sdk',
  'com.adjust.sdk:adjust-android',
  'react-native-adjust',
  'com.kochava',
  'react-native-kochava',
  'com.singular.sdk',
];

function scanText(label, text, findings) {
  const lower = text.toLowerCase();
  for (const pattern of BLOCKED_SDK_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      findings.push(`${label}: matched blocked SDK pattern "${pattern}"`);
    }
  }
}

function scanPackageJson(relPath, findings) {
  const fullPath = `${repoRoot}${relPath}`;
  if (!existsSync(fullPath)) return;
  const pkg = JSON.parse(readFileSync(fullPath, 'utf8'));
  const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  scanText(relPath, names.join('\n'), findings);
}

function scanRawFile(relPath, findings) {
  const fullPath = `${repoRoot}${relPath}`;
  if (!existsSync(fullPath)) return;
  scanText(relPath, readFileSync(fullPath, 'utf8'), findings);
}

const findings = [];
scanPackageJson('backend/package.json', findings);
scanPackageJson('platform-admin-web/package.json', findings);
scanRawFile('android/app/build.gradle.kts', findings);
scanRawFile('android/build.gradle.kts', findings);
scanRawFile('android/gradle/libs.versions.toml', findings);

if (findings.length > 0) {
  console.error('PCA-FR-123 no-ads/no-data-broker SDK inventory check FAILED:');
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`PCA-FR-123 no-ads/no-data-broker SDK inventory check passed (${BLOCKED_SDK_PATTERNS.length} blocked patterns checked across 5 manifest files).`);
