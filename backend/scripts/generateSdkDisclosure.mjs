#!/usr/bin/env node
// PCA-NFR-064 (Writer65): regenerates
// backend/src/sdkDisclosure/thirdPartySdks.generated.ts from the real
// dependency manifests (see sdkDisclosureCompute.mjs). Run this whenever a
// dependency is added/removed/upgraded in backend/package.json,
// platform-admin-web/package.json, or android/gradle/libs.versions.toml --
// backend/test/security/sdkDisclosure.test.mjs fails CI if the committed
// file has drifted from what this script would currently produce.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { computeSdkDisclosure } from './sdkDisclosureCompute.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const disclosure = await computeSdkDisclosure(repoRoot);

const outDir = fileURLToPath(new URL('../src/sdkDisclosure/', import.meta.url));
await mkdir(outDir, { recursive: true });

const fileContents = `/**
 * GENERATED FILE -- do not hand-edit. Regenerate with
 * \`node backend/scripts/generateSdkDisclosure.mjs\` (PCA-NFR-064). Source
 * of truth is backend/package.json, platform-admin-web/package.json, and
 * android/gradle/libs.versions.toml's actual dependency entries --
 * backend/test/security/sdkDisclosure.test.mjs fails CI if this file
 * drifts from what the generator would currently produce.
 */
export interface DisclosedSdk {
  readonly name: string;
  readonly version: string;
  readonly category: string;
}

export interface ThirdPartySdkDisclosure {
  readonly disclosureVersion: number;
  readonly generatedFrom: string;
  readonly surfaces: {
    readonly backend: readonly DisclosedSdk[];
    readonly platformAdminWeb: readonly DisclosedSdk[];
    readonly android: readonly DisclosedSdk[];
    readonly ios: readonly DisclosedSdk[];
  };
}

export const THIRD_PARTY_SDK_DISCLOSURE: ThirdPartySdkDisclosure = ${JSON.stringify(disclosure, null, 2)} as const;
`;

await writeFile(`${outDir}thirdPartySdks.generated.ts`, fileContents, 'utf8');
console.log(`Wrote ${outDir}thirdPartySdks.generated.ts`);
