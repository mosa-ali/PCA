import { describe, expect, it } from 'vitest';
import { validateParentIdentityNames } from '../../src/identity/identityForm';

describe('validateParentIdentityNames', () => {
  it('trims surrounding whitespace and preserves Arabic and international spelling', () => {
    expect(validateParentIdentityNames('  محمد ', ' 李 ')).toEqual({
      valid: true,
      value: { firstName: 'محمد', lastName: '李' },
    });
    expect(validateParentIdentityNames('Jean-Luc', 'O’Neill').valid).toBe(true);
  });

  it('rejects missing names, control characters, and names over the backend limit', () => {
    expect(validateParentIdentityNames(' ', 'Ali')).toEqual({
      valid: false,
      field: 'firstName',
      reason: 'required',
    });
    expect(validateParentIdentityNames('Al\u0007i', 'Ali')).toEqual({
      valid: false,
      field: 'firstName',
      reason: 'control_character',
    });
    expect(validateParentIdentityNames('A'.repeat(129), 'Ali')).toEqual({
      valid: false,
      field: 'firstName',
      reason: 'too_long',
    });
  });
});
