import { afterEach, describe, expect, it } from 'vitest';
import { __resetChildLabelsForTest, getChildLabel, hasChildLabel, setChildLabel } from '../../src/domain/childLabels';

describe('childLabels session-local store', () => {
  afterEach(() => {
    __resetChildLabelsForTest();
  });

  it('returns null for an id with no label -- the honest "unresolved" starting state', () => {
    expect(getChildLabel('child-unknown')).toBeNull();
    expect(hasChildLabel('child-unknown')).toBe(false);
  });

  it('set then get round-trips the label for that id, and only that id', () => {
    setChildLabel('child-1', 'Ahmed');
    expect(getChildLabel('child-1')).toBe('Ahmed');
    expect(hasChildLabel('child-1')).toBe(true);
    expect(getChildLabel('child-2')).toBeNull();
  });

  it('trims whitespace and never stores an empty label', () => {
    setChildLabel('child-1', '  Sara  ');
    expect(getChildLabel('child-1')).toBe('Sara');

    setChildLabel('child-2', '   ');
    expect(hasChildLabel('child-2')).toBe(false);
  });

  it('a later set for the same id overwrites the earlier one', () => {
    setChildLabel('child-1', 'Ahmed');
    setChildLabel('child-1', 'Mohammed');
    expect(getChildLabel('child-1')).toBe('Mohammed');
  });

  it('the reset hook clears every label -- this is the honest post-reload shape, simulated', () => {
    setChildLabel('child-1', 'Ahmed');
    __resetChildLabelsForTest();
    expect(getChildLabel('child-1')).toBeNull();
    expect(hasChildLabel('child-1')).toBe(false);
  });
});
