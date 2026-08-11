import { useTranslation } from 'react-i18next';
import type { CapabilityState } from '../../domain/types';

/**
 * Renders capability state with BOTH a colored dot AND a text label, so
 * state is never conveyed by color alone (docs/architecture/26 Section on
 * color-independent encoding).
 */
export function StatusBadge({ state }: { state: CapabilityState }) {
  const { t } = useTranslation();
  return (
    <span className={`status-badge status-${state}`}>
      <span className="dot" aria-hidden="true" />
      {t(`state.${state}`)}
    </span>
  );
}
