import { prisma } from "@/lib/db";

// Every agent decision and every human action gets logged here, per the
// blueprint's Level 8 "full action audit log" requirement. actorEmail null
// means the actor was an agent, not a human.
export async function logAudit(opts: {
  actorEmail?: string | null;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      actorEmail: opts.actorEmail ?? null,
      action: opts.action,
      entity: opts.entity,
      entityId: opts.entityId,
      metadata: opts.metadata ? JSON.parse(JSON.stringify(opts.metadata)) : undefined,
    },
  });
}
