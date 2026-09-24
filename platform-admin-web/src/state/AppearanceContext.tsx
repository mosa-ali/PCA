/* eslint-disable react-refresh/only-export-components -- appearance context exports its hook and provider together, like the auth context. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Appearance = 'dark' | 'slate' | 'light';
const STORAGE_KEY = 'pca-platform-appearance';
const DEFAULT_APPEARANCE: Appearance = 'dark';
const AppearanceContext = createContext<{ appearance: Appearance; setAppearance: (value: Appearance) => void } | undefined>(undefined);

function isAppearance(value: unknown): value is Appearance {
  return value === 'dark' || value === 'slate' || value === 'light';
}

function readAppearance(): Appearance {
  try {
    // eslint-disable-next-line no-restricted-properties -- only a non-sensitive visual preference is persisted here; auth stays in secureSession.
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isAppearance(stored) ? stored : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function applyAppearance(appearance: Appearance): void {
  document.documentElement.dataset.appearance = appearance;
  document.documentElement.style.colorScheme = appearance === 'light' ? 'light' : 'dark';
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setValue] = useState<Appearance>(() => readAppearance());
  const setAppearance = useCallback((value: Appearance) => {
    if (!isAppearance(value)) return;
    setValue(value);
    applyAppearance(value);
    try {
      // eslint-disable-next-line no-restricted-properties -- only a non-sensitive visual preference is persisted here; auth stays in secureSession.
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // The in-memory choice remains available when browser storage is disabled.
    }
  }, []);

  applyAppearance(appearance);
  const value = useMemo(() => ({ appearance, setAppearance }), [appearance, setAppearance]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppearance must be used within AppearanceProvider');
  return value;
}
