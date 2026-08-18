import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const documentPath = `${root}/docs/implementation/addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md`;
const document = await readFile(documentPath, 'utf8');
const requiredFragments = [
  '### 2.1 Trust boundary diagram',
  '**PCA-ADD-PA-006** The context diagram in Section 2.1 is the canonical trust-boundary diagram',
  'subgraph FamilyBoundary["Family trust boundary (unchanged by this addendum)"]',
  'subgraph PCAInfra["PCA infrastructure \u2014 not trusted with plaintext family data (doc 05/09)"]',
  'subgraph PlatformPlane["PCA Platform Administration (new \u2014 this addendum)"]',
  'ParentDev <-- "E2EE policy/activity" --> R',
  'ChildDev <-- "E2EE policy/activity" --> R',
  'PA -.->|"cannot decrypt, cannot author family policy"| FamilyStore',
];
const missing = requiredFragments.filter((fragment) => !document.includes(fragment));
const result = {
  document: 'PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md',
  canonicalDiagram: missing.length === 0 ? 'PASS' : 'FAIL',
  missing,
};
console.log(JSON.stringify(result));
if (missing.length > 0) process.exitCode = 1;
