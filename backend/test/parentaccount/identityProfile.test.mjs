import test from 'node:test';
import assert from 'node:assert/strict';
import { formatParentDisplayName, validateParentIdentityNames } from '../../dist/parentaccount/identityProfile.js';

test('Parent identity names preserve Arabic and trim surrounding whitespace', () => {
  assert.deepEqual(validateParentIdentityNames('  محمد ', ' علي  '), {
    valid: true,
    value: { firstName: 'محمد', lastName: 'علي' },
  });
  assert.equal(formatParentDisplayName({ firstName: 'محمد', lastName: 'علي' }), 'محمد علي');
});

test('Parent identity names do not impose English-only or punctuation rules', () => {
  assert.equal(validateParentIdentityNames('Jean-Luc', "O’Neill").valid, true);
  assert.equal(validateParentIdentityNames('李', '小龍').valid, true);
});

test('Parent identity names reject missing values, Unicode control characters, and overlong values', () => {
  assert.deepEqual(validateParentIdentityNames('  ', 'Ali'), { valid: false, field: 'firstName', reason: 'required' });
  assert.deepEqual(validateParentIdentityNames('Al\u0007i', 'Ali'), { valid: false, field: 'firstName', reason: 'control_character' });
  assert.deepEqual(validateParentIdentityNames('A'.repeat(129), 'Ali'), { valid: false, field: 'firstName', reason: 'too_long' });
});

test('display name is absent while legacy first or last name is missing', () => {
  assert.equal(formatParentDisplayName({ firstName: 'Amina', lastName: '' }), null);
});
