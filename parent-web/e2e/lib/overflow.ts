// Horizontal-overflow measurement that names the culprit.
//
// `scrollWidth - clientWidth` on the document alone says "6px" and nothing
// else, and the CI job log is not publicly readable -- only the assertion
// message reaches the annotations. So this returns the elements whose right
// edge leaves the viewport, widest first, with the properties that usually
// explain it (white-space, font-family), for use in the expect message.
//
// It also reports elements that overflow THEIR OWN box. A row can overflow
// its container by a few pixels under one platform's font metrics and stay
// inside the viewport only because of the card and page padding around it;
// the same row leaves the viewport under a wider face. Asserting per-element
// containment is what makes a layout claim platform-independent.
//
// Everything below runs inside page.evaluate, so it is self-contained on
// purpose (no shared helpers, no `new Function`): the console ships a
// `script-src 'self'` CSP and nothing here may depend on unsafe-eval.
import type { Page } from '@playwright/test';

export interface OverflowReport {
  /** Document-level horizontal overflow in px. */
  overflow: number;
  /** Elements whose right edge is beyond the viewport, widest first. */
  culprits: string[];
}

export interface ContainmentReport {
  /** Elements matching the selector whose scrollWidth exceeds their clientWidth by more than 1px. */
  overflowing: string[];
  checked: number;
}

export async function measureOverflow(page: Page): Promise<OverflowReport> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.evaluate(() => {
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : ''}`;
    const vw = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - vw;
    const culprits = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
      .filter(({ r }) => r.right > vw + 0.5 && r.width > 0)
      .sort((a, b) => b.r.right - a.r.right)
      .slice(0, 5)
      .map(
        ({ el, r, cs }) =>
          `${describe(el)} right=${Math.round(r.right)} width=${Math.round(r.width)} white-space=${cs.whiteSpace} font=${cs.fontFamily.slice(0, 30)} text="${(el.textContent ?? '').trim().slice(0, 40)}"`,
      );
    return { overflow, culprits };
  });
}

export async function measureContainment(page: Page, selector: string): Promise<ContainmentReport> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.evaluate((sel) => {
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : ''}`;
    const nodes = Array.from(document.querySelectorAll(sel));
    const overflowing = nodes
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map(
        (el) =>
          `${describe(el)} scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth} font=${getComputedStyle(el).fontFamily.slice(0, 30)} text="${(el.textContent ?? '').trim().slice(0, 40)}"`,
      );
    return { overflowing, checked: nodes.length };
  }, selector);
}

export function describeOverflow(label: string, report: OverflowReport): string {
  return `${label}: ${report.overflow}px of horizontal overflow${report.culprits.length ? ` -- culprits: ${report.culprits.join(' | ')}` : ''}`;
}

export function describeContainment(label: string, report: ContainmentReport): string {
  return `${label}: ${report.overflowing.length} of ${report.checked} elements overflow their own box${report.overflowing.length ? ` -- ${report.overflowing.join(' | ')}` : ''}`;
}
