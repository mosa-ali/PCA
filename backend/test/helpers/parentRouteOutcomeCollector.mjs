import { writeFile } from 'node:fs/promises';

const scenarioRows = [];
const scenarioClasses = new Set([
  'ALLOW_PROVEN',
  'EXPECTED_DENIAL',
  'PROTECTIVE_AUTHORITY_NOT_APPLICABLE',
  'AUTHORITY_UNAVAILABLE',
  'CRYPTO_DEVICE_GATED',
  'SERVICE_NOT_CONFIGURED',
  'VALIDATION_OR_PROTOCOL',
  'OPTIONAL_ROUTE_ABSENT',
]);
const blockedByValues = new Set(['GENESIS', 'TRUSTED_BROWSER']);

/**
 * Canonical TODO-14 declaration inventory: every `METHOD /templated/route`
 * declaration registered by `backend/src/http/routes/*.ts` on 2026-09-28
 * (52 declarations across 43 unique paths), matching the declaration table in
 * docs/pre_production_assessment/pca_parent_platform/parent_route_action_test_crosswalk.md
 * and re-verified mechanically against current source. Coverage is computed by
 * key comparison against this list -- never inferred from a matching row count.
 */
export const PARENT_ROUTE_DECLARATION_INVENTORY = Object.freeze([
  'DELETE /api/parent/families/:familyId/safe-zones/:zoneId',
  'GET /api/parent/csrf',
  'GET /api/parent/families/:familyId/administration-pin',
  'GET /api/parent/families/:familyId/audit-events',
  'GET /api/parent/families/:familyId/bonus-time/active-grants',
  'GET /api/parent/families/:familyId/child-requests',
  'GET /api/parent/families/:familyId/children/:childProfileId/eye-protection',
  'GET /api/parent/families/:familyId/children/:childProfileId/web-rules',
  'GET /api/parent/families/:familyId/dashboard',
  'GET /api/parent/families/:familyId/members/invitations',
  'GET /api/parent/families/:familyId/protection-alerts',
  'GET /api/parent/families/:familyId/removal-decisions',
  'GET /api/parent/families/:familyId/removal-decisions/:requestId',
  'GET /api/parent/families/:familyId/safe-zones',
  'GET /api/parent/free-access-status',
  'GET /api/parent/identity',
  'GET /api/parent/preferences',
  'GET /api/parent/session',
  'PATCH /api/parent/families/:familyId/safe-zones/:zoneId',
  'PATCH /api/parent/identity',
  'PATCH /api/parent/preferences',
  'POST /api/parent/families/:familyId/administration-pin',
  'POST /api/parent/families/:familyId/bonus-time/grant',
  'POST /api/parent/families/:familyId/bonus-time/grants/:grantId/revoke',
  'POST /api/parent/families/:familyId/child-requests/:requestId/decide',
  'POST /api/parent/families/:familyId/children/:childProfileId/eye-protection',
  'POST /api/parent/families/:familyId/children/:childProfileId/schedule-policy',
  'POST /api/parent/families/:familyId/children/:childProfileId/web-rules',
  'POST /api/parent/families/:familyId/children/:childProfileId/web-rules/remove',
  'POST /api/parent/families/:familyId/members/:accountId/remove',
  'POST /api/parent/families/:familyId/members/invitations',
  'POST /api/parent/families/:familyId/members/invitations/:invitationId/revoke',
  'POST /api/parent/families/:familyId/members/invitations/:invitationId/role',
  'POST /api/parent/families/:familyId/removal-decisions',
  'POST /api/parent/families/:familyId/removal-decisions/:requestId/decide/authorized-recovery',
  'POST /api/parent/families/:familyId/removal-decisions/:requestId/decide/local-pin',
  'POST /api/parent/families/:familyId/removal-decisions/:requestId/decide/signed',
  'POST /api/parent/families/:familyId/safe-zones',
  'POST /api/parent/login',
  'POST /api/parent/login/step-up',
  'POST /api/parent/logout',
  'POST /api/parent/member-invitations/:invitationId/accept',
  'POST /api/parent/mfa/enrollment/confirm',
  'POST /api/parent/mfa/enrollment/start',
  'POST /api/parent/mfa/recovery/complete',
  'POST /api/parent/mfa/recovery/request',
  'POST /api/parent/mfa/step-up',
  'POST /api/parent/register',
  'POST /api/parent/request-password-reset',
  'POST /api/parent/reset-password',
  'POST /api/parent/sessions/revoke-all',
  'POST /api/parent/verify-email',
]);

/**
 * Record one explicitly classified HTTP scenario when the TODO-14 collector
 * output path is enabled. Bodies, headers, credentials and identifiers are
 * intentionally excluded from the report.
 */
export function recordParentRouteScenario({
  method,
  route,
  scenarioId,
  classification,
  expectedStatus,
  response,
  blockedBy,
}) {
  if (!process.env.PCA_PARENT_ROUTE_SCENARIO_OUT) return;

  if (typeof method !== 'string' || !/^[A-Z]+$/.test(method)) throw new Error('Collector method must be uppercase HTTP method text.');
  if (typeof route !== 'string' || !route.startsWith('/api/parent/')) throw new Error('Collector route must be a templated Parent API route.');
  if (typeof scenarioId !== 'string' || !/^[a-z0-9_]+$/.test(scenarioId)) throw new Error('Collector scenarioId must be a stable lowercase identifier.');
  if (!scenarioClasses.has(classification)) throw new Error(`Unsupported Parent route scenario classification: ${classification}`);
  if (!Number.isInteger(expectedStatus) || !Number.isInteger(response?.statusCode)) throw new Error('Collector requires integer expected and observed HTTP statuses.');
  if (blockedBy !== undefined && !blockedByValues.has(blockedBy)) throw new Error(`Unsupported Parent route block marker: ${blockedBy}`);

  scenarioRows.push({
    method,
    route,
    scenarioId,
    classification,
    expectedStatus,
    actualStatus: response.statusCode,
    matched: response.statusCode === expectedStatus,
    ...(blockedBy === undefined ? {} : { blockedBy }),
  });
}

/** Write a bounded machine-readable report for this test process, if enabled. */
export async function writeParentRouteScenarioReport() {
  const outputPath = process.env.PCA_PARENT_ROUTE_SCENARIO_OUT;
  if (!outputPath || scenarioRows.length === 0) return;

  const counts = {
    scenarios: scenarioRows.length,
    routes: new Set(scenarioRows.map(({ method, route }) => `${method} ${route}`)).size,
    allowProven: 0,
    expectedDenials: 0,
    protectiveAuthorityNotApplicable: 0,
    authorityUnavailable: 0,
    cryptoDeviceGated: 0,
    serviceNotConfigured: 0,
    optionalRouteAbsent: 0,
    validationOrProtocol: 0,
    unexpected401: 0,
    unexpected403: 0,
    unexpectedOther: 0,
  };

  for (const row of scenarioRows) {
    if (row.matched) {
      if (row.classification === 'ALLOW_PROVEN') counts.allowProven += 1;
      else if (row.classification === 'EXPECTED_DENIAL') counts.expectedDenials += 1;
      else if (row.classification === 'PROTECTIVE_AUTHORITY_NOT_APPLICABLE') counts.protectiveAuthorityNotApplicable += 1;
      else if (row.classification === 'AUTHORITY_UNAVAILABLE') counts.authorityUnavailable += 1;
      else if (row.classification === 'CRYPTO_DEVICE_GATED') counts.cryptoDeviceGated += 1;
      else if (row.classification === 'SERVICE_NOT_CONFIGURED') counts.serviceNotConfigured += 1;
      else if (row.classification === 'OPTIONAL_ROUTE_ABSENT') counts.optionalRouteAbsent += 1;
      else if (row.classification === 'VALIDATION_OR_PROTOCOL') counts.validationOrProtocol += 1;
      continue;
    }

    if (row.actualStatus === 401) counts.unexpected401 += 1;
    else if (row.actualStatus === 403) counts.unexpected403 += 1;
    else counts.unexpectedOther += 1;
  }

  const collectedKeys = new Set(scenarioRows.map(({ method, route }) => `${method} ${route}`));
  const inventoryKeys = new Set(PARENT_ROUTE_DECLARATION_INVENTORY);
  const declarationsMissing = PARENT_ROUTE_DECLARATION_INVENTORY.filter((key) => !collectedKeys.has(key));
  const undeclaredCollectedKeys = [...collectedKeys].filter((key) => !inventoryKeys.has(key)).sort();
  const declarationsCollected = PARENT_ROUTE_DECLARATION_INVENTORY.length - declarationsMissing.length;
  const coverageComplete = declarationsMissing.length === 0 && undeclaredCollectedKeys.length === 0;

  const report = {
    schemaVersion: 2,
    scope: 'bounded test-file scenarios; not the all-route integrated aggregate',
    globalAggregateStatus: 'NOT_YET_PROVEN',
    inventorySource:
      'docs/pre_production_assessment/pca_parent_platform/parent_route_action_test_crosswalk.md declaration table (52 declarations / 43 unique paths), mechanically re-verified against backend/src/http/routes on 2026-09-28',
    inventoryDeclarationCount: PARENT_ROUTE_DECLARATION_INVENTORY.length,
    declarationsCollected,
    declarationsMissing,
    undeclaredCollectedKeys,
    coverageComplete,
    genesisBlockedNormalActions: scenarioRows.filter((row) => row.blockedBy === 'GENESIS').length,
    trustedBrowserBlockedNormalActions: scenarioRows.filter((row) => row.blockedBy === 'TRUSTED_BROWSER').length,
    counts,
    scenarios: scenarioRows,
  };

  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
