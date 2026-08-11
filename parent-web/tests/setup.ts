import { expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
// vitest-axe 0.1.0 ships a broken `export type *` matcher declaration file;
// the runtime value import below is correct (see tests/types/vitest-axe.d.ts
// for the matcher type augmentation applied to Vitest's Assertion type).
import { toHaveNoViolations } from 'vitest-axe/matchers';

// @ts-expect-error -- see note above; toHaveNoViolations is a real runtime value
expect.extend({ toHaveNoViolations });
