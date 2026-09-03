// A collapsed-by-default detail block.
//
// This is how the parent console keeps engineer-facing material -- device ids,
// trust/key epochs, policy revisions, and the server's own verbatim security
// explanation of the Administration PIN -- ON the page without letting it
// dominate a parent's normal use of it. Nothing is deleted; it is demoted.
//
// Native `<details>`/`<summary>` on purpose: it is keyboard operable, exposed
// correctly to assistive tech, and works before JavaScript hydrates. A custom
// button+region would have to re-implement all of that and get `aria-expanded`
// right by hand.
import type { ReactNode } from 'react';

export interface DisclosureProps {
  /** Already-translated summary label. */
  summary: string;
  children: ReactNode;
  /**
   * Open on first render. Left `false` almost everywhere: the point of a
   * disclosure is that the technical layer is opt-in.
   */
  defaultOpen?: boolean;
}

export function Disclosure({ summary, children, defaultOpen = false }: DisclosureProps) {
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary className="disclosure-summary">{summary}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
