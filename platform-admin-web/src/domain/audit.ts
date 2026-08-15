export type AuditResult = 'SUCCESS' | 'FAILURE' | 'DENIED';
export const AUDIT_RESULTS: AuditResult[] = ['SUCCESS', 'FAILURE', 'DENIED'];

export interface AuditEvent {
  eventId: string;
  eventType: string;
  actorAdminId: string;
  actorRole: string | null;
  targetRef: string | null;
  result: AuditResult;
  occurredAt: string | null;
  correlationId: string;
  metadata: Record<string, unknown> | null;
}
