import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { refunds, transactions } from '../../db/schema.js';
import { refundThreshold } from '../../domain/refund.js';
import { ROLE_MATRIX } from '../../domain/rbac.js';
import { createRefund, decideRefund, publicRefund } from '../../services/refunds.js';
import { withIdempotency } from '../idempotency.js';
import { jsonBody, parse, requirePerm, type Env } from '../http.js';

export const refundRoutes = new Hono<Env>();

const Create = z.object({
  transactionId: z.string().min(1).max(64),
  amountMinor: z.number().int().positive(),
  reason: z.string().min(3).max(500),
});

refundRoutes.post('/v1/refunds', async (c) => {
  const p = requirePerm(c, 'refunds:create');
  const body = parse(Create, await jsonBody(c));
  return withIdempotency(c, body, { required: false }, async () => ({ status: 201, body: publicRefund(await createRefund(c.get('app'), p, body)) }));
});

refundRoutes.get('/v1/refunds', async (c) => {
  const p = requirePerm(c, 'refunds:read');
  const { db } = c.get('app');
  const scope = ROLE_MATRIX[p.role].scope;
  const all = await db.select().from(refunds).orderBy(desc(refunds.createdAt)).limit(200);
  let rows = all;
  if (scope === 'tenant') rows = all.filter((r) => r.merchantId === p.tenantId);
  if (scope === 'own') {
    const mine = new Set((await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.customerId, p.id))).map((t) => t.id));
    rows = all.filter((r) => mine.has(r.transactionId));
  }
  return c.json({ items: rows.map(publicRefund), thresholdMinor: refundThreshold() });
});

const Decide = z.object({ note: z.string().max(500).optional() }).default({});

for (const decision of ['approve', 'reject'] as const) {
  refundRoutes.post(`/v1/refunds/:id/${decision}`, async (c) => {
    const p = requirePerm(c, 'refunds:approve');
    const body = parse(Decide, await c.req.json().catch(() => ({})));
    return c.json(publicRefund(await decideRefund(c.get('app'), p, c.req.param('id'), decision, body.note)));
  });
}
