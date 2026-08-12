import { describe, expect, it } from 'vitest';
import { fromSdkTargetScope, toSdkTargetScope } from '../../src/domain/wellbeingSdkTargets';

describe('wellbeingSdkTargets', () => {
  it('maps local targetChildIds to the SDK childProfileIds field', () => {
    const scope = toSdkTargetScope('MULTIPLE_CHILDREN', ['child-1', 'child-2']);
    expect(scope).toEqual({ mode: 'MULTIPLE_CHILDREN', childProfileIds: ['child-1', 'child-2'] });
  });

  it('maps the SDK childProfileIds field back to local targetChildIds', () => {
    const local = fromSdkTargetScope({ mode: 'ONE_CHILD', childProfileIds: ['child-3'] });
    expect(local).toEqual({ mode: 'ONE_CHILD', targetChildIds: ['child-3'] });
  });

  it('round-trips ALL_CHILDREN with an empty id list', () => {
    const scope = toSdkTargetScope('ALL_CHILDREN', []);
    expect(fromSdkTargetScope(scope)).toEqual({ mode: 'ALL_CHILDREN', targetChildIds: [] });
  });
});
