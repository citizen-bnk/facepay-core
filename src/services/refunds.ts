import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context';
import { paymentIntents, refunds, transactions } from '../db/schema';
import { assertChecker, assertPending, assertRefundable, requiresChecker, refundThreshold } from '../domain/refund';
import { DomainError, canAccessRow, type Principal } from '../domain/rbac';
import { appendAudit } from './audit';

type Refund = typeof refunds.$inferSelect;

export const publicRefund = (r: Refund) => ({
  id: r.id, transactionId: r.transactionId, merchantId: r.merchantId, amountMinor: r.amountMinor, currency: r.currency, reason: r.reason,
  status: r.status, makerId: r.makerId, checkerId: r.checkerId, requiresApproval: r.status === 'pending_approval' || !!r.checkerId,
  decisionNote: r.decisionNote, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null,
});

async function committedRefunds(app: AppContext, txnId: string): Promise<number> {
  const [r] = await app.db
    .select({ n: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::float8` })
    .from(refunds)
    .where(and(eq(refunds.transactionId, txnId), sql`${refunds.status} in ('pending_approval','approved','processing','processed')`));
  return Number(r?.n ?? 0);
}

/** Instruct the provider and, only on confirmation, mark processed and update the transaction. */
async function execute(app: AppContext, refund: Refund, txn: typeof transactions.$inferSelect, actor: Principal) {
  const [claimed] = await app.db.update(refunds).set({ status: 'processing' }).where(and(eq(refunds.id, refund.id), sql`${refunds.status} in ('approved')`)).returning();
  if (!claimed) return refund;
  const res = await app.providers.payments.refund({ providerRef: txn.providerRef ?? '', idempotencyKey: `refund:${refund.id}`, holderId: txn.customerId ?? '', amountMinor: refund.amountMinor, currency: refund.currency });
  if (res.status === 'processed') {
    const [done] = await app.db.update(refunds).set({ status: 'processed', providerRef: res.providerRefundRef, decidedAt: new Date() }).where(eq(refunds.id, refund.id)).returning();
    const total = await committedRefunds(app, txn.id);
    if (total >= txn.amountMinor) {
      await app.db.update(transactions).set({ status: 'refunded' }).where(eq(transactions.id, txn.id));
      await app.db.update(paymentIntents).set({ status: 'refunded', updatedAt: new Date() }).where(eq(paymentIntents.id, txn.intentId));
    }
    await appendAudit(app.db, { actorId: actor.id, actorRole: actor.role, action: 'refund.processed', tenantId: refund.merchantId, objectRef: refund.id, after: { status: 'processed' } });
    return done!;
  }
  const [st] = await app.db.update(refunds).set({ status: res.status === 'pending' ? 'processing' : 'failed' }).where(eq(refunds.id, refund.id)).returning();
  return st!;
}

export async function createRefund(app: AppContext, p: Principal, input: { transactionId: string; amountMinor: number; reason: string }) {
  const [txn] = await app.db.select().from(transactions).where(eq(transactions.id, input.transactionId));
  if (!txn || !canAccessRow(p, { tenantId: txn.merchantId, ownerUserId: txn.customerId })) throw new DomainError(404, 'not_found', 'Transaction not found');
  assertRefundable({ txnStatus: txn.status, txnAmountMinor: txn.amountMinor, alreadyRefundedMinor: await committedRefunds(app, txn.id), amountMinor: input.amountMinor });
  const needsChecker = requiresChecker(input.amountMinor);
  // Cashiers have a lower self-service limit than owners: any refund above R 500 needs a checker too.
  const cashierLimit = Number(process.env.CASHIER_REFUND_LIMIT_MINOR ?? 50_000);
  const gated = needsChecker || (p.role === 'merchant_cashier' && input.amountMinor > cashierLimit);
  const id = `rf_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const [row] = await app.db.insert(refunds).values({
    id, transactionId: txn.id, merchantId: txn.merchantId, amountMinor: input.amountMinor, currency: txn.currency, reason: input.reason,
    status: gated ? 'pending_approval' : 'approved', makerId: p.id,
  }).returning();
  await appendAudit(app.db, { actorId: p.id, actorRole: p.role, action: 'refund.create', tenantId: txn.merchantId, objectRef: id, after: { amountMinor: input.amountMinor, status: row!.status, thresholdMinor: refundThreshold() } });
  return gated ? row! : await execute(app, row!, txn, p);
}

export async function decideRefund(app: AppContext, p: Principal, id: string, decision: 'approve' | 'reject', note?: string) {
  const [r] = await app.db.select().from(refunds).where(eq(refunds.id, id));
  if (!r || !canAccessRow(p, { tenantId: r.merchantId })) throw new DomainError(404, 'not_found', 'Refund not found');
  assertPending(r.status);
  assertChecker(r.makerId, p.id);
  if (decision === 'reject') {
    const [row] = await app.db.update(refunds).set({ status: 'rejected', checkerId: p.id, decisionNote: note ?? null, decidedAt: new Date() }).where(and(eq(refunds.id, id), eq(refunds.status, 'pending_approval'))).returning();
    if (!row) throw new DomainError(409, 'invalid_state_transition', 'Refund already decided');
    await appendAudit(app.db, { actorId: p.id, actorRole: p.role, action: 'refund.reject', tenantId: r.merchantId, objectRef: id, before: { status: r.status }, after: { status: 'rejected', checkerId: p.id } });
    return row;
  }
  const [row] = await app.db.update(refunds).set({ status: 'approved', checkerId: p.id, decisionNote: note ?? null }).where(and(eq(refunds.id, id), eq(refunds.status, 'pending_approval'))).returning();
  if (!row) throw new DomainError(409, 'invalid_state_transition', 'Refund already decided');
  await appendAudit(app.db, { actorId: p.id, actorRole: p.role, action: 'refund.approve', tenantId: r.merchantId, objectRef: id, before: { status: r.status }, after: { status: 'approved', checkerId: p.id } });
  const [txn] = await app.db.select().from(transactions).where(eq(transactions.id, r.transactionId));
  return execute(app, row, txn!, p);
}
