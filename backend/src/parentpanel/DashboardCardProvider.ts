import type { DashboardCard, DashboardCardKind } from './types.js';

/**
 * One per DashboardCardKind, backed by whichever lane owns that feature's
 * actual engine (e.g. a WEB_FILTERING provider adapts PCA-5's
 * WebFilterEngine/SafeBrowserNavigationPolicy; a YOUTUBE provider adapts
 * PCA-6's ModeTransitionService). parentpanel never implements the
 * underlying feature logic itself -- only this adapter contract and the
 * aggregation below.
 */
export interface DashboardCardProvider {
  readonly kind: DashboardCardKind;
  getCard(familyId: string, childId: string | null): Promise<DashboardCard>;
}
