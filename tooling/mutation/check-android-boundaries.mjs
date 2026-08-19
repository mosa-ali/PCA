import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const failures = [];

async function text(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

function requireText(source, value, label) {
  if (!source.includes(value)) failures.push(`missing ${label}: ${value}`);
}

function forbidText(source, value, label) {
  if (source.includes(value)) failures.push(`forbidden ${label}: ${value}`);
}

const screen = await text('app/src/main/java/org/pca/app/runtime/ui/ChildHomeScreen.kt');
const english = await text('app/src/main/res/values/runtime_strings.xml');
const arabic = await text('app/src/main/res/values-ar/runtime_strings.xml');
requireText(screen, 'ManagementDisclosureCard', 'management disclosure component');
requireText(screen, 'ParentVisibilityCard', 'parent visibility component');
requireText(english, 'child_home_parent_visibility_body', 'English visibility copy');
requireText(english, 'child_home_management_active', 'English active-management copy');
requireText(arabic, 'child_home_parent_visibility_body', 'Arabic visibility copy');
requireText(arabic, 'child_home_management_active', 'Arabic active-management copy');

const vpn = await text('app/src/main/java/org/pca/app/feature/webprotection/vpn/WebProtectionVpnService.kt');
requireText(vpn, 'class WebProtectionVpnService : VpnService()', 'valid VPN service declaration');
requireText(vpn, 'startForeground(', 'visible foreground service');
requireText(vpn, '.setOngoing(true)', 'non-dismissable monitoring notification');
requireText(vpn, '.addRoute(TUNNEL_DNS_ADDRESS, 32)', 'DNS-only route');
forbidText(vpn, '.addRoute("0.0.0.0", 0)', 'general packet route');

const wellbeing = await text('app/src/main/java/org/pca/app/feature/wellbeing/ports/WellbeingFeedbackSyncPort.kt');
const safeZone = await text('app/src/main/java/org/pca/app/runtime/location/geofence/SafeZonePolicyReceiver.kt');
requireText(wellbeing, 'NudgeAggregateSummary', 'aggregate-only wellbeing export');
requireText(wellbeing, 'exportAggregateSummary', 'aggregate export port');
for (const token of ['android.util.Log', 'println(', 'sendBeacon', 'HttpURLConnection', 'OkHttpClient', 'telemetry']) {
  forbidText(wellbeing.toLowerCase(), token.toLowerCase(), 'wellbeing hidden transport/logging marker');
}
requireText(safeZone, "label.contains('|') || label.contains('\\n')", 'Safe Zone payload delimiter rejection');
requireText(safeZone, 'authority.isRecipientAuthorized(envelope.familyId, localEndpointId, envelope.trustSetEpoch, envelope.keyEpoch)', 'Safe Zone recipient key-epoch authorization');
requireText(safeZone, 'envelope.trustSetEpoch,\n                envelope.keyEpoch,', 'Safe Zone sender key-epoch authorization');

if (failures.length > 0) {
  console.error(JSON.stringify({ root, failures }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ root, status: 'PASS' }));
}
