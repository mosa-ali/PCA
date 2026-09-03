// THE DASHBOARD MUST NEVER DRAW A NUMBER IT DOES NOT HAVE.
//
// Two specific fabrications are pinned shut here:
//
//  1. A WEEKLY TREND. There is no weekly or historical usage source anywhere
//     in this codebase -- `ScreenTimeStatus` carries a single elapsed/limit
//     pair. The card therefore ships as an honest unavailable card. Deriving
//     seven days from one number, drawing a placeholder curve, or drawing a
//     flat line at zero would each be a positive claim about how long a child
//     used their device.
//
//  2. A ZERO-LENGTH BAR. "No screen time used" and "we could not read the
//     screen time" look identical if you draw an empty meter, and only one of
//     them is true for a child whose device has not reported.
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import Dashboard from '../../src/pages/Dashboard';
import { renderWithProviders } from '../utils/renderWithProviders';

/**
 * Located by the card's own heading. A chart title also appears as the
 * figure's `<figcaption>` (visually hidden when the card already shows it) and
 * inside the svg's `<title>`, so a plain text query is ambiguous by design.
 */
async function cardByTitle(title: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: title, level: 3 });
  return heading.closest('article') as HTMLElement;
}

async function childCard(name: string): Promise<HTMLElement> {
  const link = await screen.findByRole('link', {
    name: (accessibleName: string) => accessibleName.startsWith(`Open ${name}`),
  });
  return link.closest('article') as HTMLElement;
}

/**
 * The per-child screen-time reads are a SECOND round trip, fired once the
 * child roster resolves. Asserting "no bar is drawn" before they land would
 * pass for the wrong reason, so every screen-time assertion waits for the one
 * child that does have a reading to actually render its bar.
 */
async function waitForScreenTimeReadings(): Promise<void> {
  const amir = await childCard('Amir (DEV)');
  await waitFor(() => {
    expect(amir.querySelector('.chart-meter')).not.toBeNull();
  });
}

describe('Dashboard honest unavailability', () => {
  it('ships the weekly trend as an unavailable card with its real title intact', async () => {
    renderWithProviders(<Dashboard />);
    const card = await cardByTitle('Weekly trend');

    expect(within(card).getByText(/Weekly history isn't available yet/)).toBeInTheDocument();
    expect(card.querySelector('.chart-unavailable')).not.toBeNull();
  });

  it('draws no series, no baseline and no placeholder curve in the weekly trend card', async () => {
    renderWithProviders(<Dashboard />);
    const card = await cardByTitle('Weekly trend');

    // The only <svg> permitted here is the state icon. Nothing that could be
    // read as data: no plotted rects, no line, no path with a "d" that traces
    // a series, no <text> tick labels.
    expect(card.querySelectorAll('.chart-svg')).toHaveLength(0);
    expect(card.querySelectorAll('rect')).toHaveLength(0);
    expect(card.querySelectorAll('line')).toHaveLength(0);
    expect(card.querySelectorAll('polyline')).toHaveLength(0);
    expect(card.querySelectorAll('text')).toHaveLength(0);
    expect(card.querySelectorAll('.chart-meter')).toHaveLength(0);
  });

  it('draws no bar for a child whose screen-time read is unavailable, and says so instead', async () => {
    renderWithProviders(<Dashboard />);
    await waitForScreenTimeReadings();

    // Yousef's fixture screen-time state is UNAVAILABLE.
    const card = await childCard('Yousef (DEV)');
    const screenTimeRow = within(card).getByText('Screen time').closest('.child-metric') as HTMLElement;
    expect(screenTimeRow.querySelectorAll('.chart-meter')).toHaveLength(0);

    const pill = screenTimeRow.querySelector('.status-badge');
    expect(pill).toHaveClass('status-UNAVAILABLE');
    expect(pill?.textContent).toContain('Unavailable');
  });

  it('does draw a bar for a child that has a real reading', async () => {
    renderWithProviders(<Dashboard />);
    await waitForScreenTimeReadings();

    const card = await childCard('Amir (DEV)');
    const screenTimeRow = within(card).getByText('Screen time').closest('.child-metric') as HTMLElement;
    expect(screenTimeRow.querySelector('.chart-meter')).not.toBeNull();
    // 12 of 60 fixture minutes.
    expect(screenTimeRow.textContent).toContain('12 of 60 minutes');
  });

  it('lists every child in the screen-time chart data table, including the ones with no reading', async () => {
    renderWithProviders(<Dashboard />);
    await waitForScreenTimeReadings();

    const card = await cardByTitle('Screen time today');
    const table = card.querySelector('table.chart-data') as HTMLElement;
    expect(table).not.toBeNull();
    // The tabular equivalent is not optional, and it must not quietly agree
    // with a ring that only counted some of the children.
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(within(table).getByText('Yousef (DEV)')).toBeInTheDocument();
    expect(table.textContent).toContain('Unavailable');
  });
});
