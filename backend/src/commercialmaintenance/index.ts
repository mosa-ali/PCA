/**
 * PCA-COMMERCIAL-RUNTIME-1 -- public surface for the Coordinator's
 * `main.ts` wiring (interval timer + shutdown hook, per
 * `ROUND5_INTERFACE_CONTRACTS.md`'s "Coordinator-owned startup wiring"
 * note). This lane delivers `runOnce()` and its dependencies only; it does
 * not itself start any timer.
 */
export type { CommercialMaintenanceResult, CommercialMaintenanceRunner, CommercialMaintenanceLogger } from './types.js';
export { CONSOLE_COMMERCIAL_MAINTENANCE_LOGGER } from './types.js';
export type { CommercialMaintenanceConfig } from './config.js';
export { CommercialMaintenanceConfigError, COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS, COMMERCIAL_MAINTENANCE_ENV_KEYS, loadCommercialMaintenanceConfig } from './config.js';
export { MySqlCommercialMaintenanceRunner } from './CommercialMaintenanceRunner.js';
