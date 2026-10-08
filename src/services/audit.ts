import { desc, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.js';
import { auditEvents } from '../db/schema.js';
import { GENESIS, computeHash, hashObject, type AuditInput, type ChainRow } from '../domain/audit.js';

/** Appends to the hash-chained audit log. Serialised via an advisory lock so the chain never forks. */
export async function appendAudit(db: Db, input: AuditInput, at = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7001)`);
    const [last] = await tx.select({ seq: auditEvents.seq, hash: auditEvents.hash }).from(auditEvents).orderBy(desc(auditEvents.seq)).limit(1);
    const prevHash = last?.hash ?? GENESIS;
    const nextSeq = (last?.seq ?? 0) + 1;
    const row = {
      seq: nextSeq,
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      tenantId: input.tenantId,
      objectRef: input.objectRef,
      beforeHash: input.before === undefined ? null : hashObject(input.before),
      afterHash: input.after === undefined ? null : hashObject(input.after),
      createdAt: at,
      prevHash,
    };
    const hash = computeHash(row);
    await tx.insert(auditEvents).values({ ...row, id: `aud_${randomUUID()}`, hash });
  });
}

export async function loadChain(db: Db): Promise<ChainRow[]> {
  const rows = await db.select().from(auditEvents).orderBy(auditEvents.seq);
  return rows.map((r) => ({ ...r }));
}
