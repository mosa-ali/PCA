// A real WAI-ARIA tab set: `role="tablist"` / `role="tab"` / `role="tabpanel"`,
// roving `tabindex`, and Arrow-key movement.
//
// THE RTL RULE THIS COMPONENT EXISTS TO GET RIGHT:
// arrow-key direction follows the RESOLVED DOCUMENT DIRECTION, not the source
// order. Under `dir="rtl"` the first tab is painted on the right, so ArrowLeft
// must move to the NEXT tab and ArrowRight to the PREVIOUS one. Hardcoding
// "ArrowRight = next" would make an Arabic parent's keyboard walk the tab strip
// backwards relative to what they see.
//
// Direction is read from the document element rather than from i18next, because
// `src/i18n/index.ts:applyDocumentDirection` is what actually paints the page
// and is what a test (and a user with a per-page override) changes.
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDefinition {
  /**
   * Stable identifier. Callers that keep tab state in the URL use this verbatim
   * as the `?section=` value, so it is part of a linkable contract -- do not
   * derive it from a translated label.
   */
  id: string;
  /** Already-translated visible label. */
  label: string;
}

export interface TabsProps {
  /** Accessible name for the tab strip (`aria-label` on the tablist). */
  label: string;
  tabs: readonly TabDefinition[];
  activeId: string;
  onSelect: (id: string) => void;
  /** The active tab's panel content. */
  children: ReactNode;
  /** Prefix for the generated `id`s, so two tab sets can coexist on a page. */
  idPrefix?: string;
}

function resolvedDirection(): 'ltr' | 'rtl' {
  if (typeof document === 'undefined') return 'ltr';
  return document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
}

export function Tabs({ label, tabs, activeId, onSelect, children, idPrefix = 'tab' }: TabsProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const foundIndex = tabs.findIndex((tab) => tab.id === activeId);
  const activeIndex = foundIndex === -1 ? 0 : foundIndex;
  const activeTab = tabs[activeIndex];

  const moveTo = (index: number) => {
    if (tabs.length === 0) return;
    const wrapped = ((index % tabs.length) + tabs.length) % tabs.length;
    onSelect(tabs[wrapped].id);
    buttonRefs.current[wrapped]?.focus();
  };

  // Handled on the focused TAB, not on the tablist: with a roving tabindex the
  // tablist itself is never focusable, so a handler there would only ever fire
  // by bubbling and would make the container claim an interactive role it
  // cannot support.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const rtl = resolvedDirection() === 'rtl';
    const nextKey = rtl ? 'ArrowLeft' : 'ArrowRight';
    const previousKey = rtl ? 'ArrowRight' : 'ArrowLeft';

    if (event.key === nextKey) {
      event.preventDefault();
      moveTo(activeIndex + 1);
    } else if (event.key === previousKey) {
      event.preventDefault();
      moveTo(activeIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(tabs.length - 1);
    }
  };

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tab-list">
        {tabs.map((tab, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                buttonRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-${tab.id}`}
              className="tab"
              aria-selected={selected}
              aria-controls={`${idPrefix}panel-${tab.id}`}
              // Roving tabindex: exactly one tab is in the page tab order, and
              // Arrow keys move within the strip.
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              onKeyDown={onKeyDown}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {activeTab && (
        <div
          role="tabpanel"
          id={`${idPrefix}panel-${activeTab.id}`}
          className="tab-panel"
          aria-labelledby={`${idPrefix}-${activeTab.id}`}
          tabIndex={0}
        >
          {children}
        </div>
      )}
    </div>
  );
}
