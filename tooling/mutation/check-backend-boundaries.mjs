import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const failures = [];
const read = (relative) => readFile(path.join(root, relative), 'utf8');

function requireText(source, value, label) {
  if (!source.includes(value)) failures.push(`missing ${label}: ${value}`);
}

function forbidText(source, value, label) {
  if (source.includes(value)) failures.push(`forbidden ${label}: ${value}`);
}

async function listTypeScriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listTypeScriptFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

const diagnostics = await read('src/relay/diagnostics.ts');
const service = await read('src/relay/RelayService.ts');
const server = await read('src/http/buildServer.ts');
const safeZone = await read('src/location/SafeZoneRepository.ts');
const diagnosticMethodStart = service.indexOf('  private emitDiagnostic(');
const diagnosticMethodEnd = service.indexOf('  private async purgeExpired(', diagnosticMethodStart);
const diagnosticMethod = service.slice(diagnosticMethodStart, diagnosticMethodEnd);

if (!diagnostics.includes("if (byteLength <= 1024) return 'SMALL';") &&
    !diagnostics.includes("if (byteLength < 1025) return 'SMALL';")) {
  failures.push('small ciphertext boundary is not preserved');
}
requireText(diagnostics, "if (byteLength <= 16 * 1024) return 'MEDIUM';", 'medium ciphertext boundary');
requireText(diagnostics, 'messageId: record.messageId,', 'opaque message id projection');
requireText(diagnostics, 'ciphertextSizeClass: classifyCiphertextSize(record.ciphertext.length),', 'ciphertext size class projection');
forbidText(diagnostics, 'messageId: record.ciphertext', 'ciphertext in message id');
forbidText(diagnostics, "record.ciphertext.toString('utf8')", 'ciphertext materialization in diagnostics');
forbidText(diagnostics, 'ciphertext: record.ciphertext,', 'ciphertext field in diagnostics');

requireText(diagnosticMethod, 'try {', 'best-effort diagnostic guard');
requireText(diagnosticMethod, 'this.diagnosticSink', 'diagnostic sink');
requireText(diagnosticMethod, 'catch {', 'diagnostic failure catch');
requireText(server, 'Fastify({ logger: false })', 'disabled Fastify logger');
forbidText(server, 'logger: true', 'enabled Fastify logger');
requireText(safeZone, 'assertOpaqueToken(input.familyId);', 'Safe Zone family identifier validation');
requireText(safeZone, 'assertOpaqueToken(input.recipientEndpointId);', 'Safe Zone recipient identifier validation');
requireText(safeZone, 'assertCanonicalBase64Url(input.ciphertextB64, 1, 65_535);', 'Safe Zone ciphertext envelope validation');
requireText(safeZone, 'assertCanonicalBase64Url(input.nonceB64, 12, 64);', 'Safe Zone nonce envelope validation');
forbidText(safeZone, 'label', 'readable Safe Zone policy field');

const prohibited = ['telemetry', 'analytics', '/collect', '/ingest', '/usage-report', '/metrics/report'];
const routePattern = /\bapp\.(get|post|put|patch|delete)\(\s*[`'\"]([^`'\"]+)[`'\"]/g;
for (const file of await listTypeScriptFiles(path.join(root, 'src', 'http'))) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(routePattern)) {
    const term = prohibited.find((candidate) => match[2].toLowerCase().includes(candidate));
    if (term) failures.push(`${file}: route contains ${term}`);
  }
}

if (failures.length > 0) {
  console.error(JSON.stringify({ root, failures }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ root, status: 'PASS' }));
}
