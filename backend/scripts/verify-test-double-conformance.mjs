// FABLE-A003: test-double conformance gate. Proves that every method a
// production repository INTERFACE declares also exists as a callable
// function on its in-memory test double -- the landmine this closes is a
// double that silently drifts out of sync with its interface (a method
// added to the interface, or renamed, with nobody updating the double), so
// any FUTURE test that wires the double into a service calling that method
// throws "is not a function" instead of the interface mismatch being caught
// here, mechanically, before that ever happens.
//
// HOW THE REQUIRED METHOD LIST IS DERIVED
// ----------------------------------------
// Per-pairing method lists are parsed directly from the production
// TypeScript interface declaration using the TypeScript compiler API
// (`typescript` is already a backend devDependency -- see package.json),
// NOT hand-copied. A hand-maintained method-name list is exactly the kind
// of thing that drifts the moment someone adds a method to the interface
// and forgets to update a second, unrelated list; parsing the real .ts file
// means this gate is self-updating the instant the interface changes.
//
// A small hand-maintained REGISTRY mapping "which double implements which
// interface" is unavoidable and fine (see PAIRINGS below) -- there is no
// mechanical way to discover "this .mjs file is the test double for that
// .ts interface" other than someone saying so once.
//
// WHAT THIS DOES NOT CHECK
// -------------------------
// Only method PRESENCE (name + "is a function"), never signatures, arity,
// return shapes, or runtime behaviour -- deliberately narrow, matching the
// specific failure mode ("repository.xyz is not a function") this exists to
// catch. It also only runs against interfaces/doubles named in PAIRINGS
// below; adding a new repository pairing here is a one-line addition.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const BACKEND_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Parses `interfaceName` out of the TypeScript source at `relativeTsPath`
 * (relative to backend/) and returns the names of every member declared
 * directly on it that is a callable method -- MethodSignature members
 * (`foo(...): T;`) only. Property members that happen to hold a function
 * TYPE (`foo: (...) => T;`) are intentionally also included since every
 * repository interface in this codebase declares its methods as
 * MethodSignatures, not function-typed properties -- if that ever stops
 * being true this function should be revisited, not silently under-count.
 */
function interfaceMethodNames(relativeTsPath, interfaceName) {
  const absolutePath = path.join(BACKEND_ROOT, relativeTsPath);
  const sourceText = readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(absolutePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  let target = null;
  const visit = (node) => {
    if (target) return;
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      target = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (!target) {
    throw new Error(`interface ${interfaceName} not found in ${relativeTsPath} -- has it been renamed or moved?`);
  }

  const names = [];
  for (const member of target.members) {
    if (ts.isMethodSignature(member) && member.name) {
      names.push(member.name.getText(sourceFile));
    } else if (ts.isPropertySignature(member) && member.name && member.type && ts.isFunctionTypeNode(member.type)) {
      names.push(member.name.getText(sourceFile));
    }
  }
  if (names.length === 0) {
    throw new Error(`interface ${interfaceName} in ${relativeTsPath} yielded zero methods -- the parse almost certainly broke, not that the interface is empty.`);
  }
  return names;
}

/**
 * The pure check at the heart of this gate: which of `requiredNames` are
 * NOT present as a callable function on `candidate`. Takes a plain object
 * (never a class instance requiring `new`) because every double in this
 * codebase is a factory function returning a plain object literal.
 */
function missingMethods(candidate, requiredNames) {
  return requiredNames.filter((name) => typeof candidate[name] !== 'function');
}

/**
 * Hand-maintained pairing registry -- the one part of this gate that
 * cannot be derived mechanically (see file header). Each entry names the
 * production interface file/name, and the double module's path plus the
 * factory export that builds an instance to check.
 */
const PAIRINGS = [
  {
    label: 'FamilyMemberInvitationRepository <-> inMemoryFamilyMemberInvitationRepository.mjs',
    interfaceFile: 'src/familymembers/FamilyMemberInvitationRepository.ts',
    interfaceName: 'FamilyMemberInvitationRepository',
    doubleFile: 'test/support/inMemoryFamilyMemberInvitationRepository.mjs',
    factoryExport: 'createInMemoryFamilyMemberInvitationRepository',
  },
  {
    label: 'EntitlementRepository <-> inMemoryEntitlementRepository.mjs',
    interfaceFile: 'src/entitlements/EntitlementRepository.ts',
    interfaceName: 'EntitlementRepository',
    doubleFile: 'test/support/inMemoryEntitlementRepository.mjs',
    factoryExport: 'createInMemoryEntitlementRepository',
  },
];

async function loadDoubleInstance(pairing) {
  const moduleUrl = pathToFileURL(path.join(BACKEND_ROOT, pairing.doubleFile)).href;
  const mod = await import(moduleUrl);
  const factory = mod[pairing.factoryExport];
  if (typeof factory !== 'function') {
    throw new Error(`${pairing.doubleFile} does not export a function named ${pairing.factoryExport}`);
  }
  return factory();
}

async function checkPairing(pairing) {
  const requiredNames = interfaceMethodNames(pairing.interfaceFile, pairing.interfaceName);
  const instance = await loadDoubleInstance(pairing);
  const missing = missingMethods(instance, requiredNames);
  return { pairing, requiredNames, instance, missing };
}

// ---------------------------------------------------------------------
// REQUIRED NEGATIVE CONTROL (FABLE-A003): a gate that always reports
// "everything present" is worthless. Before trusting the real run below,
// prove `missingMethods` actually detects an absence -- via a SHALLOW COPY
// of a real, freshly-built double instance with one required key deleted,
// never by editing any double's source file. Zero permanent mutation:
// `instance` itself (built fresh, only referenced by `broken`'s spread) is
// discarded after this block: the real run further down builds its own
// fresh instances independently.
// ---------------------------------------------------------------------
async function runNegativeControl(pairing) {
  const requiredNames = interfaceMethodNames(pairing.interfaceFile, pairing.interfaceName);
  const instance = await loadDoubleInstance(pairing);
  const victimMethod = requiredNames[0];

  const broken = { ...instance };
  delete broken[victimMethod];

  const missingOnBroken = missingMethods(broken, requiredNames);
  const detected = missingOnBroken.includes(victimMethod);

  const missingOnReal = missingMethods(instance, requiredNames);
  const realDoubleClean = missingOnReal.length === 0;

  return { pairing, victimMethod, detected, realDoubleClean, missingOnReal };
}

console.log('=== Test-double conformance gate (FABLE-A003) ===\n');

console.log('-- Negative control (proves the gate can actually fail) --');
let negativeControlOk = true;
for (const pairing of PAIRINGS) {
  const result = await runNegativeControl(pairing);
  const line1 = `[${result.detected ? 'OK' : 'FAIL'}] ${pairing.label}: deleting "${result.victimMethod}" from a shallow copy ${result.detected ? 'was' : 'was NOT'} detected as missing`;
  const line2 = `[${result.realDoubleClean ? 'OK' : 'FAIL'}] ${pairing.label}: the real, unmodified double reports zero missing methods${result.realDoubleClean ? '' : ` (missing: ${result.missingOnReal.join(', ')})`}`;
  console.log(line1);
  console.log(line2);
  if (!result.detected || !result.realDoubleClean) negativeControlOk = false;
}

if (!negativeControlOk) {
  console.error('\nNEGATIVE CONTROL FAILED -- this gate cannot be trusted to catch a real drift. Fix the gate itself before relying on the run below.');
  process.exitCode = 1;
} else {
  console.log('\nNegative control passed: the gate demonstrably fails when a required method is missing, and passes on the real double.\n');
}

console.log('-- Real conformance check (production interfaces vs. real doubles) --');
let allConform = true;
for (const pairing of PAIRINGS) {
  const result = await checkPairing(pairing);
  if (result.missing.length === 0) {
    console.log(`[OK] ${pairing.label}: all ${result.requiredNames.length} interface method(s) present.`);
  } else {
    allConform = false;
    console.error(`[FAIL] ${pairing.label}: missing ${result.missing.length} method(s) declared on the interface but absent from the double:`);
    for (const name of result.missing) console.error(`  - ${name}`);
  }
}

console.log('\n=== SUMMARY ===');
console.log(`Negative control: ${negativeControlOk ? 'PASSED' : 'FAILED'}`);
console.log(`Conformance: ${allConform ? 'PASSED' : 'FAILED'} (${PAIRINGS.length} pairing(s) checked)`);

if (!negativeControlOk || !allConform) {
  process.exitCode = 1;
} else {
  console.log('\nAll test doubles conform to their production interfaces.');
}
