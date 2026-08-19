/**
 * PCA-NFR-014: aggregate product telemetry is a separate consent surface.
 *
 * This module intentionally contains no account-creation consent, family id,
 * child id, URL, coordinate, app-usage, face, or content field. A caller must
 * hold this explicit grant before an aggregate event can be handed to a
 * sink. No ingestion route or durable transport is created here.
 */

export type AggregateTelemetryMetric =
  | 'CRASH_COUNT'
  | 'FEATURE_INTERACTION_COUNT'
  | 'FILTER_FALSE_POSITIVE_COUNT';

export interface AggregateTelemetryConsent {
  readonly aggregateProductTelemetry: boolean;
  readonly changedAtUtc: Date | null;
}

export interface AggregateTelemetryEvent {
  readonly metric: AggregateTelemetryMetric;
  readonly bucket: string;
  readonly count: number;
}

export const DEFAULT_AGGREGATE_TELEMETRY_CONSENT: Readonly<AggregateTelemetryConsent> = Object.freeze({
  aggregateProductTelemetry: false,
  changedAtUtc: null,
});

export function defaultAggregateTelemetryConsent(): AggregateTelemetryConsent {
  return { ...DEFAULT_AGGREGATE_TELEMETRY_CONSENT };
}

export function grantAggregateTelemetry(consent: AggregateTelemetryConsent, changedAtUtc: Date): AggregateTelemetryConsent {
  assertValidConsentTimestamp(changedAtUtc);
  return { aggregateProductTelemetry: true, changedAtUtc: new Date(changedAtUtc.getTime()) };
}

export function revokeAggregateTelemetry(consent: AggregateTelemetryConsent, changedAtUtc: Date): AggregateTelemetryConsent {
  assertValidConsentTimestamp(changedAtUtc);
  return { aggregateProductTelemetry: false, changedAtUtc: new Date(changedAtUtc.getTime()) };
}

export function canEmitAggregateTelemetry(consent: AggregateTelemetryConsent): boolean {
  return consent.aggregateProductTelemetry === true;
}

/**
 * The event shape is deliberately aggregate-only. `bucket` is a bounded
 * product dimension, not a caller-supplied URL, title, profile, or content
 * value. The exact-key check prevents accidental expansion into an
 * identity-bearing event object.
 */
export function isAllowedAggregateTelemetryEvent(candidate: unknown): candidate is AggregateTelemetryEvent {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const value = candidate as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (keys.join('|') !== 'bucket|count|metric') return false;
  if (!['CRASH_COUNT', 'FEATURE_INTERACTION_COUNT', 'FILTER_FALSE_POSITIVE_COUNT'].includes(value.metric as string)) return false;
  if (typeof value.bucket !== 'string' || !/^[A-Z][A-Z0-9_]{0,31}$/.test(value.bucket)) return false;
  return Number.isInteger(value.count) && (value.count as number) >= 0;
}

/**
 * Applies both gates at the last local hand-off: consent must be explicitly
 * granted and the event must be aggregate-only. A rejected event is never
 * passed to the sink.
 */
export function emitAggregateTelemetryIfConsented(
  consent: AggregateTelemetryConsent,
  event: unknown,
  sink: (event: AggregateTelemetryEvent) => void,
): boolean {
  if (!canEmitAggregateTelemetry(consent) || !isAllowedAggregateTelemetryEvent(event)) return false;
  sink(event);
  return true;
}

function assertValidConsentTimestamp(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError('changedAtUtc must be a valid Date');
}
