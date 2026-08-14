import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Standard modal-dialog focus behaviour, shared across every `role="dialog"`
 * surface in this app (step-up re-auth, confirmation dialogs, ...): while
 * `active`, keeps Tab/Shift+Tab cycling confined to the dialog (a focus
 * trap), and restores focus to whatever element had it immediately before
 * the dialog opened once `active` becomes false again (or the component
 * unmounts while still active).
 */
export function useModalFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  const wasActiveRef = useRef(false);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Capture the trigger element synchronously during render, on the exact
  // transition from inactive -> active -- must not be an effect, or the
  // dialog's own initial-focus effect could commit first and this would
  // capture the dialog's own field instead of the real trigger.
  if (active && !wasActiveRef.current) {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
  }
  wasActiveRef.current = active;

  useEffect(() => {
    if (!active) return undefined;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (e.shiftKey) {
        if (current === first || !container.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (current === last || !container.contains(current)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef]);
}
