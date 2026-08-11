// vitest-axe@0.1.0 ships a broken `export type *` re-export for its matcher
// module (node_modules/vitest-axe/matchers.d.ts), so TypeScript cannot see
// `toHaveNoViolations` as a real value or as a Vitest matcher even though it
// works correctly at runtime (verified by the passing test suite). This
// shim augments Vitest's Assertion interface directly instead of relying on
// the upstream (broken) type declarations.
import 'vitest';

interface CustomAxeMatchers<R = unknown> {
  toHaveNoViolations(): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional interface-merging augmentation
  interface Assertion<T = unknown> extends CustomAxeMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional interface-merging augmentation
  interface AsymmetricMatchersContaining extends CustomAxeMatchers {}
}
