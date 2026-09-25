import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import { ParentEmailFamilyLookup } from '../../src/components/common/ParentEmailFamilyLookup';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock('../../src/api/platformAdminApiClient', () => ({
  platformAdminApi: { post: mockPost },
}));

function renderLookup(onFamilyIdChange = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ParentEmailFamilyLookup id="lookup" familyId="" onFamilyIdChange={onFamilyIdChange} />
      </MemoryRouter>
    </I18nextProvider>,
  );
  return onFamilyIdChange;
}

describe('Parent Email family lookup outcomes', () => {
  afterEach(() => {
    cleanup();
    mockPost.mockReset();
  });

  it('normalizes surrounding whitespace before submitting the lookup request', async () => {
    mockPost.mockResolvedValue({ outcome: 'ELIGIBLE_FAMILY_FOUND', familyIds: ['family-1'] });
    const onFamilyIdChange = renderLookup();

    await userEvent.type(screen.getByLabelText('Search by Parent Email'), '  Parent@example.test  ');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(mockPost).toHaveBeenCalledWith('/platform-admin/accounts/resolve-parent-email', {
      email: 'Parent@example.test',
      includeDeleted: false,
    });
    expect(onFamilyIdChange).toHaveBeenCalledWith('family-1');
  });

  it('distinguishes an unknown Parent account from an existing ineligible account', async () => {
    mockPost.mockResolvedValue({ outcome: 'ACCOUNT_NOT_FOUND' });
    const onFamilyIdChange = renderLookup();

    await userEvent.type(screen.getByLabelText('Search by Parent Email'), 'unknown@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('status')).toHaveTextContent('No Parent account was found for this email.');
    expect(onFamilyIdChange).toHaveBeenCalledWith('');
  });

  it.each([
    ['EMAIL_NOT_VERIFIED', 'The Parent account exists, but its email is not verified.'],
    ['ACCOUNT_SUSPENDED', 'The Parent account or its family is suspended.'],
    ['FAMILY_NOT_PROVISIONED', 'The Parent account exists, but no family has been provisioned.'],
    ['ALREADY_ENTITLED', "The Parent account's family already has an entitlement."],
    ['OTHER_APPROVED_REASON', 'The Parent account is not eligible for this action.'],
  ])('explains the %s ineligible outcome and keeps its family isolated', async (reason, message) => {
    mockPost.mockResolvedValue({ outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', reason, familyIds: ['linked-family'] });
    const onFamilyIdChange = renderLookup();

    await userEvent.type(screen.getByLabelText('Search by Parent Email'), 'parent@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('status')).toHaveTextContent(message);
    expect(onFamilyIdChange).toHaveBeenCalledWith('linked-family');
    expect(screen.queryByRole('option', { name: 'unrelated-family' })).not.toBeInTheDocument();
  });

  it('lets the operator choose among the eligible families returned for this Parent', async () => {
    mockPost.mockResolvedValue({ outcome: 'ELIGIBLE_FAMILY_FOUND', familyIds: ['family-a', 'family-b'] });
    const onFamilyIdChange = renderLookup();

    await userEvent.type(screen.getByLabelText('Search by Parent Email'), 'parent@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    const familyChoice = await screen.findByLabelText('Choose a family linked to this Parent');
    expect(familyChoice).toHaveValue('');
    await userEvent.selectOptions(familyChoice, 'family-b');
    expect(onFamilyIdChange).toHaveBeenLastCalledWith('family-b');
  });
});
