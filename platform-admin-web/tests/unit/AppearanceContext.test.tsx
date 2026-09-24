import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import { AppearanceProvider, useAppearance } from '../../src/state/AppearanceContext';

describe('Platform appearance preference', () => {
  afterEach(() => {
    cleanup();
    // eslint-disable-next-line no-restricted-properties -- test cleanup for the appearance preference only.
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-appearance');
  });

  it('defaults to dark and persists supported choices across provider remounts', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <AppearanceProvider>{children}</AppearanceProvider>;
    const first = renderHook(() => useAppearance(), { wrapper });
    expect(first.result.current.appearance).toBe('dark');
    act(() => first.result.current.setAppearance('slate'));
    expect(document.documentElement.dataset.appearance).toBe('slate');
    // eslint-disable-next-line no-restricted-properties -- asserts the nonsensitive appearance preference only.
    expect(window.localStorage.getItem('pca-platform-appearance')).toBe('slate');
    first.unmount();
    const second = renderHook(() => useAppearance(), { wrapper });
    expect(second.result.current.appearance).toBe('slate');
    act(() => second.result.current.setAppearance('light'));
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('ignores invalid saved appearance values', () => {
    // eslint-disable-next-line no-restricted-properties -- invalid appearance preference fixture, no auth data.
    window.localStorage.setItem('pca-platform-appearance', '#ff00ff');
    const wrapper = ({ children }: { children: React.ReactNode }) => <AppearanceProvider>{children}</AppearanceProvider>;
    const hook = renderHook(() => useAppearance(), { wrapper });
    expect(hook.result.current.appearance).toBe('dark');
  });
});
