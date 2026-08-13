import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Standard modal-dialog focus behaviour, shared across every `role="dialog"`
 * surface in this app (step-up re-auth, delete confirmation, custom-message
 * editor, ...): while `active`, keeps Tab/Shift+Tab cycling confined to the
 * dialog (a focus trap), and restores focus to whatever element had it
 * immediately before the dialog opened once `active` becomes false again
 * (or the component unmounts while still active). This is on top of --
 * never a replacement for -- each dialog's own initial-focus effect and
 * Escape-to-close handler.
 */
export function useModalFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  const wasActiveRef = useRef(false);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Capture the trigger element synchronously during render, on the exact
  // transition from inactive -> active. This must NOT be done inside an
  // effect: this hook's own initial-focus effect in the *caller* (e.g.
  // "focus the first field") commits in the same pass and would already
  // have moved focus by the time a same-priority useEffect here ran,
  // capturing the dialog's own field instead of the real trigger.
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
      // Restore focus to the trigger only if it is still attached and
      // nothing more specific (e.g. another dialog) has already taken over.
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef]);
}
