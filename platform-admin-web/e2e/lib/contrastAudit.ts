// Real-browser colour-contrast audit helpers shared by the contrast specs.
//
// Two independent measurements are taken on every page:
//
// 1. axe-core's `color-contrast` rule (industry-standard WCAG 2.1 AA check).
// 2. A script-independent audit of every visible text node whose content is
//    Arabic script. This exists because axe-core 4.10's contrast matcher
//    skips elements whose visible text contains no "word" characters as it
//    defines them, and Arabic-only text is skipped -- verified on
//    2026-09-08: on /settings in Arabic axe evaluated 0 text nodes (passes 0,
//    violations 0) while the page held ~700 characters of Arabic copy. A
//    gate that silently evaluates nothing in the product's second launch
//    language is exactly the false-green class this repository keeps
//    finding, so the Arabic audit computes the WCAG ratio itself from the
//    computed foreground colour and the nearest opaque ancestor background.
//    Nodes over gradients/images/semi-transparent backgrounds are reported
//    as `skipped` (not silently passed) so vacuity stays visible.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

const require = createRequire(import.meta.url);
export const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

export interface AxeContrastSummary {
  violations: { id: string; impact: string | null; nodes: { target: string[] }[] }[];
  incompleteCount: number;
  passesCount: number;
}

export interface ArabicContrastSummary {
  evaluated: number;
  skipped: number;
  failures: { text: string; ratio: number; required: number; fg: string; bg: string; path: string }[];
}

export async function runAxeContrast(page: Page): Promise<AxeContrastSummary> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const hasAxe = await page.evaluate(() => typeof (window as unknown as { axe?: unknown }).axe !== 'undefined');
  if (!hasAxe) await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: AxeContrastSummary['violations']; incomplete: unknown[]; passes: unknown[] }> } }).axe;
    const results = await axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
    return { violations: results.violations, incompleteCount: results.incomplete.length, passesCount: results.passes.length };
  });
}

export async function runArabicTextContrast(page: Page): Promise<ArabicContrastSummary> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.evaluate(() => {
    const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
    const parse = (css: string): [number, number, number, number] | null => {
      const m = css.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
      if (!m) return null;
      return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    };
    const lum = (c: [number, number, number, number]) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ratio = (a: [number, number, number, number], b: [number, number, number, number]) => {
      const l1 = lum(a); const l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const pathOf = (el: Element) => {
      const parts: string[] = []; let cur: Element | null = el;
      while (cur && cur !== document.body && parts.length < 5) { parts.unshift(cur.tagName.toLowerCase() + (cur.id ? `#${cur.id}` : cur.className && typeof cur.className === 'string' ? `.${cur.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')}` : '')); cur = cur.parentElement; }
      return parts.join(' > ');
    };
    const summary: ArabicContrastSummary = { evaluated: 0, skipped: 0, failures: [] };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node.textContent ?? '').trim();
      if (!text || !ARABIC.test(text)) continue;
      const el = node.parentElement; if (!el) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
      const rect = el.getBoundingClientRect(); if (rect.width === 0 || rect.height === 0) continue;
      const fg = parse(style.color); if (!fg || fg[3] < 1) { summary.skipped += 1; continue; }
      // Nearest ancestor with an opaque, non-image background.
      let bg: [number, number, number, number] | null = null; let cur: Element | null = el; let skip = false;
      while (cur) {
        const cs = getComputedStyle(cur);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') { skip = true; break; }
        const c = parse(cs.backgroundColor);
        if (c && c[3] >= 1) { bg = c; break; }
        if (c && c[3] > 0) { skip = true; break; }
        cur = cur.parentElement;
      }
      if (skip) { summary.skipped += 1; continue; }
      if (!bg) bg = [255, 255, 255, 1];
      const size = parseFloat(style.fontSize); const weight = parseInt(style.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = large ? 3 : 4.5;
      const r = ratio(fg, bg);
      summary.evaluated += 1;
      if (r < required) summary.failures.push({ text: text.slice(0, 40), ratio: Math.round(r * 100) / 100, required, fg: style.color, bg: `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`, path: pathOf(el) });
    }
    return summary;
  });
}
