import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MessagePreview } from '../../src/components/wellbeing/MessagePreview';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('wellbeing message preview simulator', () => {
  it('renders the in-app card surface as a small card, not full screen', () => {
    const { container } = renderWithProviders(
      <MessagePreview text="Nice work today!" languageTag="en" surface="IN_APP_CARD" />,
    );
    expect(screen.getByText('Nice work today!')).toBeInTheDocument();
    expect(container.querySelector('.preview-card')).toBeTruthy();
    expect(container.querySelector('.preview-fullscreen')).toBeNull();
  });

  it('redacts the lock-screen surface -- never shows message body on a locked device', () => {
    renderWithProviders(<MessagePreview text="Private family content" languageTag="en" surface="LOCK_SCREEN_REDACTED" />);
    expect(screen.queryByText('Private family content')).not.toBeInTheDocument();
    expect(screen.getByText('New message available')).toBeInTheDocument();
  });

  it('renders Arabic text with RTL direction', () => {
    const { container } = renderWithProviders(
      <MessagePreview text="أحسنت اليوم" languageTag="ar" surface="IN_APP_CARD" />,
    );
    const node = container.querySelector('[dir="rtl"]');
    expect(node).toBeTruthy();
    expect(screen.getByText('أحسنت اليوم')).toBeInTheDocument();
  });

  it('strips any embedded markup from custom message text (defense in depth, never dangerouslySetInnerHTML)', () => {
    renderWithProviders(<MessagePreview text="<b>bold</b> hello" languageTag="en" surface="IN_APP_CARD" />);
    expect(screen.getByText('bold hello')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });
});
