// The seven-state status ramp is a HONESTY control, not styling.
//
// Two failures this pins down, both of which shipped before:
//
//  1. A state that a parent must act on, or that the console cannot verify,
//     rendered with less visual weight than the good state -- smaller, greyer,
//     or `opacity`-faded -- so "pending delivery" and "not verified" read as
//     decorative footnotes next to a green "Active".
//  2. A cached or unavailable read rendering as `ok`. A console that cannot
//     currently reach a device must never draw the conclusion that the device
//     is fine.
//
// So this file asserts BOTH halves: the domain mapping in
// src/domain/dashboardStatus.ts, and the stylesheet contract that gives every
// ramp state the same pill.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RAMP_SEVERITY_ORDER,
  applyFreshness,
  needsParentAttention,
  rampForPolicyStatus,
  rampForStatus,
  severityRank,
  worstOf,
  type RampState,
} from '../../src/domain/dashboardStatus';
import type { CapabilityState, InstallApprovalCapabilityState, ProtectionDisplayState } from '../../src/domain/types';
import type { PolicyStatus } from '../../src/domain/policyStatus';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../../src/styles/global.css'), 'utf8');

/** Every `{ ... }` block in the stylesheet, paired with its selector list. */
function ruleBlocks(css: string): { selector: string; body: string }[] {
  const blocks: { selector: string; body: string }[] = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutComments)) !== null) {
    blocks.push({ selector: match[1].trim(), body: match[2] });
  }
  return blocks;
}

const CAPABILITY_STATES: CapabilityState[] = [
  'ACTIVE',
  'LIMITED',
  'UNAVAILABLE',
  'NEEDS_ATTENTION',
  'OFFLINE',
  'PENDING_DELIVERY',
  'PARTIALLY_APPLIED',
  'EPOCH_STALE',
  'REVOKED',
];
const PROTECTION_STATES: ProtectionDisplayState[] = ['STANDARD', 'PROTECTED', 'AUTHORIZATION_REQUIRED', 'NOT_SUPPORTED'];
const INSTALL_STATES: InstallApprovalCapabilityState[] = [
  'ENFORCED',
  'REQUEST_ONLY',
  'AUTHORIZATION_REQUIRED',
  'NOT_SUPPORTED',
  'PLATFORM_LIMITED',
];
const POLICY_STATUSES: PolicyStatus[] = [
  'LOCAL_DRAFT',
  'PENDING_SYNC',
  'PENDING_DELIVERY',
  'DELIVERED',
  'APPLIED',
  'FAILED',
  'EXPIRED',
  'STALE',
];

describe('every status vocabulary maps onto the ramp, with nothing dropped or merged', () => {
  it.each([...CAPABILITY_STATES, ...PROTECTION_STATES, ...INSTALL_STATES])('maps %s', (state) => {
    expect(RAMP_SEVERITY_ORDER).toContain(rampForStatus(state));
  });

  it.each(POLICY_STATUSES)('maps policy status %s', (status) => {
    expect(RAMP_SEVERITY_ORDER).toContain(rampForPolicyStatus(status));
  });

  it('places each value in the ramp state the design spec names', () => {
    expect(rampForStatus('ACTIVE')).toBe('ok');
    expect(rampForStatus('STANDARD')).toBe('ok');
    expect(rampForStatus('PROTECTED')).toBe('ok');
    expect(rampForStatus('ENFORCED')).toBe('ok');
    expect(rampForStatus('LIMITED')).toBe('limited');
    expect(rampForStatus('PARTIALLY_APPLIED')).toBe('limited');
    expect(rampForStatus('NEEDS_ATTENTION')).toBe('attention');
    expect(rampForStatus('EPOCH_STALE')).toBe('attention');
    expect(rampForStatus('AUTHORIZATION_REQUIRED')).toBe('attention');
    expect(rampForStatus('OFFLINE')).toBe('offline');
    expect(rampForStatus('PENDING_DELIVERY')).toBe('pending');
    expect(rampForStatus('UNAVAILABLE')).toBe('unverified');
    expect(rampForStatus('NOT_SUPPORTED')).toBe('unverified');
    expect(rampForStatus('PLATFORM_LIMITED')).toBe('unverified');
    expect(rampForStatus('REVOKED')).toBe('error');
  });

  it('never renders REQUEST_ONLY as ok -- it means "we can ask, we cannot block"', () => {
    expect(rampForStatus('REQUEST_ONLY')).toBe('limited');
    expect(rampForStatus('REQUEST_ONLY')).not.toBe('ok');
  });

  it('never renders a queued policy as applied', () => {
    expect(rampForPolicyStatus('PENDING_SYNC')).toBe('pending');
    expect(rampForPolicyStatus('PENDING_DELIVERY')).toBe('pending');
    expect(rampForPolicyStatus('DELIVERED')).toBe('pending');
    expect(rampForPolicyStatus('APPLIED')).toBe('ok');
    expect(rampForPolicyStatus('LOCAL_DRAFT')).toBe('offline');
    expect(rampForPolicyStatus('FAILED')).toBe('error');
    expect(rampForPolicyStatus('EXPIRED')).toBe('attention');
    expect(rampForPolicyStatus('STALE')).toBe('attention');
  });

  it('treats an unrecognised value as unverified, never as ok', () => {
    expect(rampForStatus(undefined)).toBe('unverified');
    expect(rampForStatus('SOMETHING_NEW' as CapabilityState)).toBe('unverified');
    expect(rampForPolicyStatus(null)).toBe('unverified');
  });
});

describe('severity order and worstOf', () => {
  it('orders the ramp worst-first', () => {
    expect([...RAMP_SEVERITY_ORDER]).toEqual([
      'error',
      'attention',
      'offline',
      'unverified',
      'limited',
      'pending',
      'ok',
    ]);
  });

  it('returns the ORIGINAL enum so the card still shows that value’s own honest label', () => {
    expect(worstOf('ACTIVE', 'EPOCH_STALE', 'PENDING_DELIVERY')).toBe('EPOCH_STALE');
    expect(worstOf('ACTIVE', 'ACTIVE', 'ACTIVE')).toBe('ACTIVE');
    expect(worstOf('REVOKED', 'NEEDS_ATTENTION')).toBe('REVOKED');
    expect(worstOf('PENDING_DELIVERY', 'LIMITED')).toBe('LIMITED');
    expect(worstOf('OFFLINE', 'UNAVAILABLE')).toBe('OFFLINE');
  });

  it('ignores missing inputs and returns null when given nothing', () => {
    expect(worstOf(null, undefined, 'ACTIVE')).toBe('ACTIVE');
    expect(worstOf(null, undefined)).toBeNull();
    expect(worstOf()).toBeNull();
  });

  it('keeps the first argument on a severity tie, so callers control precedence', () => {
    expect(worstOf('NEEDS_ATTENTION', 'EPOCH_STALE')).toBe('NEEDS_ATTENTION');
    expect(worstOf('EPOCH_STALE', 'NEEDS_ATTENTION')).toBe('EPOCH_STALE');
  });

  it('does not escalate pending or partially-applied into an alarm', () => {
    // PENDING_DELIVERY / PARTIALLY_APPLIED are surfaced on the card, never
    // counted as "needs attention" -- inflating them is a lie in the other
    // direction.
    expect(needsParentAttention(rampForStatus('PENDING_DELIVERY'))).toBe(false);
    expect(needsParentAttention(rampForStatus('PARTIALLY_APPLIED'))).toBe(false);
    expect(needsParentAttention(rampForStatus('NEEDS_ATTENTION'))).toBe(true);
    expect(needsParentAttention(rampForStatus('REVOKED'))).toBe(true);
  });
});

describe('freshness can only ever make a headline LESS confident', () => {
  it('leaves a live read alone', () => {
    expect(applyFreshness('ok', 'LIVE')).toBe('ok');
    expect(applyFreshness('pending', 'LIVE')).toBe('pending');
  });

  it('collapses a cached or unavailable good read to unverified', () => {
    // The mechanical enforcement of "never show protection as ACTIVE if the
    // system cannot verify it".
    expect(applyFreshness('ok', 'CACHED')).toBe('unverified');
    expect(applyFreshness('ok', 'UNAVAILABLE')).toBe('unverified');
    expect(applyFreshness('pending', 'CACHED')).toBe('unverified');
    expect(applyFreshness('limited', 'CACHED')).toBe('unverified');
    expect(applyFreshness('ok', null)).toBe('unverified');
  });

  it('never softens a state that is already worse', () => {
    expect(applyFreshness('error', 'CACHED')).toBe('error');
    expect(applyFreshness('attention', 'UNAVAILABLE')).toBe('attention');
    expect(applyFreshness('offline', 'CACHED')).toBe('offline');
  });

  it('ranks unverified worse than limited/pending/ok and better than offline', () => {
    expect(severityRank('unverified')).toBeLessThan(severityRank('limited'));
    expect(severityRank('unverified')).toBeGreaterThan(severityRank('offline'));
  });
});

describe('the stylesheet gives every ramp state the same pill', () => {
  const RAMPS: RampState[] = ['ok', 'limited', 'attention', 'pending', 'offline', 'unverified', 'error'];

  it.each(RAMPS)('defines the fg/bg/border token trio for %s', (ramp) => {
    expect(CSS).toContain(`--status-${ramp}-fg:`);
    expect(CSS).toContain(`--status-${ramp}-bg:`);
    expect(CSS).toContain(`--status-${ramp}-border:`);
  });

  it.each([...CAPABILITY_STATES, ...PROTECTION_STATES, ...INSTALL_STATES])(
    'gives .status-%s a ramp fill rather than one shared neutral',
    (state) => {
      const rule = ruleBlocks(CSS).find((block) =>
        block.selector.split(',').some((part) => part.trim() === `.status-${state}`),
      );
      expect(rule, `.status-${state} must be styled`).toBeDefined();
      expect(rule?.body).toMatch(/--status-[a-z]+-fg/);
      expect(rule?.body).toMatch(/--status-[a-z]+-bg/);
    },
  );

  it.each(POLICY_STATUSES)('gives .policy-status-%s a ramp fill', (status) => {
    const rule = ruleBlocks(CSS).find((block) =>
      block.selector.split(',').some((part) => part.trim() === `.policy-status-${status}`),
    );
    expect(rule, `.policy-status-${status} must be styled`).toBeDefined();
    expect(rule?.body).toMatch(/--status-[a-z]+-fg/);
  });

  it('uses no `opacity` anywhere in the pill rules', () => {
    // De-emphasising the honest states with opacity is exactly what made them
    // read as decorative, and on a light background it also drops their
    // contrast unpredictably.
    const offenders = ruleBlocks(CSS)
      .filter((block) => /\.status-|\.policy-status-|\.status-badge/.test(block.selector))
      .filter((block) => /(^|[^-])opacity\s*:/.test(block.body))
      .map((block) => block.selector);
    expect(offenders).toEqual([]);
  });

  it('gives every state the same font-size, weight and padding by declaring them once on .status-badge', () => {
    const base = ruleBlocks(CSS).find((block) => block.selector === '.status-badge');
    expect(base).toBeDefined();
    expect(base?.body).toMatch(/font-size:\s*var\(--text-sm\)/);
    expect(base?.body).toMatch(/font-weight:\s*var\(--weight-semibold\)/);
    expect(base?.body).toMatch(/padding:/);
    // No per-state rule may re-declare any of them.
    const perState = ruleBlocks(CSS).filter(
      (block) =>
        /\.status-[A-Z_]|\.policy-status-[A-Z_]/.test(block.selector) && block.selector !== '.status-badge',
    );
    for (const rule of perState) {
      expect(rule.body, rule.selector).not.toMatch(/font-size:/);
      expect(rule.body, rule.selector).not.toMatch(/font-weight:/);
      expect(rule.body, rule.selector).not.toMatch(/padding:/);
    }
  });
});
