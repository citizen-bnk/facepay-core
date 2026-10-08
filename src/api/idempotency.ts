import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { Db } from '../db/client';
import { idempotencyKeys } from '../db/schema';
import { hashObject } from '../domain/audit';
import { DomainError } from '../domain/rbac';
import type { Env } from './http';

/**
 * Exactly-once business effect for POSTs. Same (principal, route, key) + same body => the original
 * response is replayed and the handler does not run again. Same key + different body => 422.
 */
export async function withIdempotency<T>(
  c: Context<Env>,
  body: unknown,
  opts: { required: boolean },
  handler: () => Promise<{ status: number; body: T }>,
): Promise<Response> {
  const key = c.req.header('Idempotency-Key');
  if (!key) {
    if (opts.required) throw new DomainError(400, 'idempotency_key_required', 'Idempotency-Key header is required');
    const r = await handler();
    return c.json(r.body as any, r.status as any);
  }
  if (key.length > 255) throw new DomainError(400, 'invalid_idempotency_key', 'Idempotency-Key too long');
  const db: Db = c.get('app').db;
  const p = c.get('principal');
  const scope = `${p.id}|${c.req.method}|${c.req.path}`;
  const requestHash = hashObject(body ?? null);

  const inserted = await db.insert(idempotencyKeys).values({ scope, key, requestHash, state: 'in_progress' }).onConflictDoNothing().returning();
  if (inserted.length === 0) {
    const [row] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    if (!row) throw new DomainError(409, 'idempotency_conflict', 'Retry the request');
    if (row.requestHash !== requestHash) throw new DomainError(422, 'idempotency_key_reuse', 'Idempotency-Key was used with a different request body');
    if (row.state !== 'done') throw new DomainError(409, 'request_in_progress', 'A request with this Idempotency-Key is still in progress');
    c.header('Idempotent-Replayed', 'true');
    return c.json(row.responseBody as any, row.responseStatus as any);
  }
  try {
    const r = await handler();
    await db.update(idempotencyKeys).set({ state: 'done', responseStatus: r.status, responseBody: r.body as any }).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    return c.json(r.body as any, r.status as any);
  } catch (e) {
    // Failed attempts are not cached, so the client may retry with the same key once fixed.
    await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    throw e;
  }
}
