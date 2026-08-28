import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeUserFacingError, errorDiagnosticDetail } from '../i18n/errorMessages';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const { t } = useTranslation();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  // The CAUSE is kept, not a pre-rendered sentence. `error` below is derived
  // from it on every render, so the message is localized in the language that
  // is current when it is read (a mid-error language switch re-translates it)
  // and the original error object stays available for diagnostics.
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailure(null);
    fn()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          // The developer-facing detail (internal operation names, endpoint
          // trust state, the "see src/cryptoGate.ts" pointer) is preserved
          // here on purpose -- it is exactly what a developer needs and
          // exactly what a parent must not be shown as the error sentence.
          console.error('[pca] async load failed:', errorDiagnosticDetail(err), err);
          setFailure({ cause: err });
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return {
    data,
    loading,
    error: failure ? describeUserFacingError(failure.cause, t) : null,
    reload,
  };
}
