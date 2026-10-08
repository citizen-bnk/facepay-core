import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { refunds, settlementBatches, transactions } from '../../db/schema.js';
import { DomainError, ROLE_MATRIX } from '../../domain/rbac.js';
import { walletFor } from '../../services/payments.js';
import { publicTxn } from '../../services/serialize.js';
import { decodeCursor, encodeCursor, pageParams, requirePerm, type Env } from '../http.js';
import { publicRefund } from '../../services/refunds.js';

export const moneyRoutes = new Hono<Env>();

const STATUSES = ['pending', 'authorised', 'captured', 'declined', 'refunded'];

function txnScope(p: ReturnType<typeof requirePerm>): SQL | undefined {
  const scope = ROLE_MATRIX[p.role].scope;
  if (scope === 'own') return eq(transactions.customerId, p.id);
  if (scope === 'tenant') return eq(transactions.merchantId, p.tenantId);
  return undefined;
}

moneyRoutes.get('/v1/wallet', async (c) => {
  const p = requirePerm(c, 'wallet:read');
  const app = c.get('app');
  const { acct, methods } = await walletFor(app, p.id);
  if (!acct) throw new DomainError(404, 'wallet_not_found', 'No provider account linked');
  const recent = await app.db.select().from(transactions).where(eq(transactions.customerId, p.id)).orderBy(desc(transactions.createdAt), desc(transactions.id)).limit(5);
  return c.json({
    provider: acct.provider,
    balanceSource: 'provider',
    balanceAsOf: acct.asOf.toISOString(),
    availableBalanceMinor: acct.availableBalanceMinor,
    currency: acct.currency,
    methods: methods.map((m) => ({ id: m.tokenRef, type: m.type, maskedDisplay: m.maskedDisplay, state: m.state })),
    recent: recent.map(publicTxn),
  });
});

moneyRoutes.get('/v1/transactions', async (c) => {
  const p = requirePerm(c, 'transactions:read');
  const { db } = c.get('app');
  const { limit, cursor } = pageParams(c);
  const where: (SQL | undefined)[] = [txnScope(p)];
  const status = c.req.query('status');
  if (status) {
    if (!STATUSES.includes(status)) throw new DomainError(422, 'validation_error', `status must be one of ${STATUSES.join(', ')}`);
    where.push(eq(transactions.status, status));
  }
  const q = c.req.query('q')?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m).slice(0, 80)}%`;
    where.push(or(ilike(transactions.merchantName, like), ilike(transactions.id, like), ilike(transactions.intentId, like)));
  }
  const cur = decodeCursor(cursor);
  if (cur) where.push(sql`(${transactions.createdAt}, ${transactions.id}) < (${cur.at.toISOString()}::timestamptz, ${cur.id})`);
  const rows = await db.select().from(transactions).where(and(...where)).orderBy(desc(transactions.createdAt), desc(transactions.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return c.json({ items: page.map(publicTxn), nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null });
});

moneyRoutes.get('/v1/transactions/:id', async (c) => {
  const p = requirePerm(c, 'transactions:read');
  const { db } = c.get('app');
  const [t] = await db.select().from(transactions).where(and(eq(transactions.id, c.req.param('id')), txnScope(p)));
  if (!t) throw new DomainError(404, 'not_found', 'Transaction not found');
  const rf = await db.select().from(refunds).where(eq(refunds.transactionId, t.id));
  let reconciliationState = 'unsettled';
  if (t.settlementBatchId) {
    const [b] = await db.select().from(settlementBatches).where(eq(settlementBatches.id, t.settlementBatchId));
    reconciliationState = b?.reconciliationStatus ?? 'unsettled';
  }
  const isCustomer = p.role === 'customer';
  return c.json({
    ...publicTxn(t),
    providerConfirmed: t.status === 'captured' || t.status === 'refunded',
    resultCode: t.resultCode,
    providerRef: isCustomer ? undefined : t.providerRef,
    settlementBatchId: t.settlementBatchId,
    reconciliationState,
    capturedAt: t.capturedAt?.toISOString() ?? null,
    refunds: rf.map(publicRefund),
  });
});
