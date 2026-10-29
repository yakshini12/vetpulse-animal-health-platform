import type { AuthUser } from '../auth/middleware.js';
import { prisma } from '../db.js';
import type { Prisma } from '@prisma/client';

export type AuditTargetType = 'CASE' | 'SAMPLE' | 'TASK' | 'IMPORT_BATCH' | 'USER';

export interface AuditInput {
  actor: AuthUser;
  eventType: string;
  targetType: AuditTargetType;
  targetId: string;
  targetLabel: string;
  summary: string;
  meta?: Record<string, unknown>;
}

/**
 * Writes an audit event. Designed to run inside an existing transaction client
 * so the audit row and the change it describes commit atomically. Callers may
 * also pass the shared prisma client for side-effect-free logging.
 */
export async function recordAudit(
  input: AuditInput,
  client: Pick<typeof prisma, 'auditEvent'> = prisma,
): Promise<void> {
  await client.auditEvent.create({
    data: {
      actorId: input.actor.id,
      actorName: input.actor.name,
      eventType: input.eventType,
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      summary: input.summary,
      // Only whitelisted metadata is passed by callers; never secrets or tokens.
      meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
