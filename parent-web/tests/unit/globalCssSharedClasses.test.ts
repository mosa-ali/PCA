// Shared class names referenced from TSX with no matching CSS rule render as
// unstyled markup with no visible error anywhere. `.plain-list` was used by 8
// lists across 7 pages and had no rule at all, so all of them fell back to
// browser default bullets and indent; `.sr-only` had none either, which made
// text meant only for screen readers VISIBLE on the page.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src');
const CSS = readFileSync(resolve(SRC, 'styles/global.css'), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function definedClasses(css: string): Set<string> {
  return new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
}

function referencedClasses(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8');
    const literals = [
      ...[...source.matchAll(/className=["']([^"']+)["']/g)].map((m) => m[1]),
      // Template-literal classNames: drop the ${...} holes, keep the static part.
      ...[...source.matchAll(/className=\{`([^`]*)`\}/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, ' ')),
    ];
    for (const literal of literals) {
      for (const name of literal.split(/\s+/).filter(Boolean)) {
        if (!/^[A-Za-z][\w-]*$/.test(name)) continue;
        // A trailing hyphen is the static half of a dynamic name that had its
        // `${...}` suffix stripped above (`status-${state}`,
        // `web-rule-status-${status}`); the real rules are the enumerated
        // `.status-ACTIVE` etc. variants, so this is not a missing rule.
        if (name.endsWith('-')) continue;
        used.set(name, [...(used.get(name) ?? []), file]);
      }
    }
  }
  return used;
}

describe('shared CSS classes referenced from TSX', () => {
  it('defines .plain-list as the flat, bullet-free list its 8 call sites expect', () => {
    expect(CSS).toMatch(/\.plain-list\s*\{[^}]*list-style:\s*none/);
    expect(CSS).toMatch(/\.plain-list\s*\{[^}]*padding:\s*0/);
  });

  it('defines .sr-only so screen-reader-only text is not rendered visibly', () => {
    expect(CSS).toMatch(/\.sr-only[^{]*\{[^}]*position:\s*absolute/);
    expect(CSS).toMatch(/\.sr-only[^{]*\{[^}]*clip:\s*rect\(0, 0, 0, 0\)/);
  });

  it('defines .text-muted using the existing muted-text token', () => {
    expect(CSS).toMatch(/\.text-muted\s*\{[^}]*var\(--color-text-muted\)/);
  });

  // The remaining unmatched classes are reported here rather than silently
  // ignored. Each one is a genuinely ambiguous visual intent (which colours?
  // which size?) that needs a design decision, not a guess, so they are pinned
  // as a known list: adding a NEW unstyled class fails this test.
  const KNOWN_UNSTYLED = [
    'app-config-error',
    'app-config-error-detail',
    'btn-inline',
    'btn-secondary',
    'btn-sm',
    'connection-banner',
    'connection-banner-offline',
    'connection-banner-reconnected',
    'invitation-qr-code',
    'offline-draft-notice',
    'offline-notice',
    'permission-entry',
  ];

  it('has no unstyled class beyond the known, design-decision-pending list', () => {
    const defined = definedClasses(CSS);
    const unstyled = [...referencedClasses().keys()].filter((name) => !defined.has(name)).sort();
    expect(unstyled).toEqual([...KNOWN_UNSTYLED].sort());
  });
});
