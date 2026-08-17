import { useTranslation } from 'react-i18next';
import type { CapabilityState, ProtectionDisplayState } from '../../domain/types';

type StatusState = CapabilityState | ProtectionDisplayState;

/**
 * Renders capability state with BOTH a colored dot AND a text label, so
 * state is never conveyed by color alone (docs/architecture/26 Section on
 * color-independent encoding).
 */
export function StatusBadge({ state }: { state: StatusState }) {
  const { t } = useTranslation();
  return (
    <span className={`status-badge status-${state}`}>
      <span className="dot" aria-hidden="true" />
      {t(`state.${state}`)}
    </span>
  );
}
