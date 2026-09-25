// PCA-DEC-030 -- ParentCommercialStepUpAuthority decision order. The step-up
// grant is consumed only after account, family and ADMINISTRATOR checks pass,
// so a denied caller can never burn a legitimate administrator's grant.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ParentCommercialStepUpAuthority } from '../../dist/parentaccount/mfa/ParentCommercialStepUpAuthority.js';

function build({ account, role = 'ADMINISTRATOR', mfa = 'ACTIVE', consumes = true } = {}) {
  const consumed = [];
  const authority = new ParentCommercialStepUpAuthority({
    accounts: { findByServiceAccountId: async (id) => (id === 'svc-1' ? account : null) },
    memberships: { findActiveRole: async () => role },
    mfa: {
      posture: async () => ({ status: mfa }),
      consumeCommercialStepUp: async (...args) => {
        consumed.push(args);
        return consumes;
      },
    },
  });
  return { authority, consumed };
}

const ACCOUNT = { accountId: 'acct-1', status: 'VERIFIED', disabledAt: null, familyId: 'fam-1' };

test('ADMINISTRATOR + ACTIVE authenticator + consumable grant for this operation -> OWNER_AUTHORIZED', async () => {
  const { authority, consumed } = build({ account: ACCOUNT });
  assert.equal(await authority.authorize('svc-1', 'fam-1', 'BILLING_CHECKOUT_CREATE', 'tok'), 'OWNER_AUTHORIZED');
  assert.deepEqual(consumed, [['acct-1', 'fam-1', 'BILLING_CHECKOUT_CREATE', 'tok']]);
});

for (const [name, overrides, expected] of [
  ['unknown service account', { account: null }, 'ROLE_DENIED'],
  ['unverified account', { account: { ...ACCOUNT, status: 'PENDING_VERIFICATION' } }, 'ROLE_DENIED'],
  ['disabled account', { account: { ...ACCOUNT, disabledAt: new Date() } }, 'ROLE_DENIED'],
  ['other family', { account: { ...ACCOUNT, familyId: 'fam-2' } }, 'ROLE_DENIED'],
  ['VIEWER', { account: ACCOUNT, role: 'VIEWER' }, 'ROLE_DENIED'],
  ['CHILD', { account: ACCOUNT, role: 'CHILD' }, 'ROLE_DENIED'],
  ['revoked membership', { account: ACCOUNT, role: null }, 'ROLE_DENIED'],
  ['no authenticator yet', { account: ACCOUNT, mfa: 'GRACE' }, 'STEP_UP_REQUIRED'],
]) {
  test(`${name} -> ${expected}, and no step-up grant is consumed`, async () => {
    const { authority, consumed } = build(overrides);
    assert.equal(await authority.authorize('svc-1', 'fam-1', 'BILLING_CHECKOUT_CREATE', 'tok'), expected);
    assert.equal(consumed.length, 0);
  });
}

test('missing, expired, replayed or wrong-operation grant (consume refuses) -> STEP_UP_REQUIRED', async () => {
  const { authority } = build({ account: ACCOUNT, consumes: false });
  assert.equal(await authority.authorize('svc-1', 'fam-1', 'FAMILY_COMMERCIAL_AUTO_RENEW_CANCEL', undefined), 'STEP_UP_REQUIRED');
});
