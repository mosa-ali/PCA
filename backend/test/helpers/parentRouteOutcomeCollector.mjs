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
}) {
  if (!process.env.PCA_PARENT_ROUTE_SCENARIO_OUT) return;

  if (typeof method !== 'string' || !/^[A-Z]+$/.test(method)) throw new Error('Collector method must be uppercase HTTP method text.');
  if (typeof route !== 'string' || !route.startsWith('/api/parent/')) throw new Error('Collector route must be a templated Parent API route.');
  if (typeof scenarioId !== 'string' || !/^[a-z0-9_]+$/.test(scenarioId)) throw new Error('Collector scenarioId must be a stable lowercase identifier.');
  if (!scenarioClasses.has(classification)) throw new Error(`Unsupported Parent route scenario classification: ${classification}`);
  if (!Number.isInteger(expectedStatus) || !Number.isInteger(response?.statusCode)) throw new Error('Collector requires integer expected and observed HTTP statuses.');

  scenarioRows.push({
    method,
    route,
    scenarioId,
    classification,
    expectedStatus,
    actualStatus: response.statusCode,
    matched: response.statusCode === expectedStatus,
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

  const report = {
    schemaVersion: 1,
    scope: 'bounded test-file scenarios; not the all-route integrated aggregate',
    globalAggregateStatus: 'NOT_YET_PROVEN',
    inventoryDeclarationCount: 52,
    // This first slice has no canonical inventory-key comparison yet; never
    // infer whole-inventory coverage from a matching row count.
    coverageComplete: false,
    counts,
    scenarios: scenarioRows,
  };

  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
