import { and, eq, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { devices, metrics, refunds, settlementBatches, transactions } from '../../db/schema';
import { requirePerm, type Env } from '../http';

export const dashboardRoutes = new Hono<Env>();

dashboardRoutes.get('/v1/admin/overview', async (c) => {
  requirePerm(c, 'admin:overview');
  const { db } = c.get('app');
  const [m] = await db.select().from(metrics).where(and(eq(metrics.key, 'admin_overview'), eq(metrics.scope, 'platform')));
  const v = (m?.value ?? {}) as Record<string, unknown>;
  return c.json({
    ...v,
    asOf: m?.refreshedAt.toISOString() ?? null,
    // Metrics tie to a versioned event source and say how fresh they are.
    meta: { source: m?.source ?? null, version: m?.version ?? null, refreshedAt: m?.refreshedAt.toISOString() ?? null, note: 'Snapshot refreshed from the transaction journal; not real-time.' },
  });
});

dashboardRoutes.get('/v1/merchant/dashboard', async (c) => {
  const p = requirePerm(c, 'merchant:dashboard');
  const { db } = c.get('app');
  const tenant = p.tenantId;
  const [m] = await db.select().from(metrics).where(and(eq(metrics.key, 'merchant_dashboard'), eq(metrics.scope, tenant)));
  let base = m?.value as Record<string, any> | undefined;
  if (!base) {
    // Fallback: compute from the journal for tenants without a metrics snapshot.
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await db.select().from(transactions).where(and(eq(transactions.merchantId, tenant), eq(transactions.status, 'captured'), gte(transactions.createdAt, since)));
    const total = rows.reduce((a, t) => a + t.amountMinor, 0);
    const byDay = new Map<string, number>();
    const byCh = new Map<string, number>();
    for (const t of rows) {
      const d = t.createdAt.toISOString().slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? 0) + t.amountMinor);
      byCh.set(t.channel, (byCh.get(t.channel) ?? 0) + 1);
    }
    base = {
      kpis: { totalSalesMinor: total, totalCustomers: new Set(rows.map((r) => r.customerId)).size, averageTransactionMinor: rows.length ? Math.round(total / rows.length) : 0, currency: 'ZAR', deltas: {} },
      salesTrend: [...byDay].sort().map(([date, amountMinor]) => ({ date, amountMinor })),
      paymentTypes: [...byCh].map(([type, n]) => ({ type, pct: Math.round((n / rows.length) * 100) })),
    };
  }
  const fleetRows = await db.select({ health: devices.health, connection: devices.connection, n: sql<number>`count(*)::int` }).from(devices).where(eq(devices.merchantId, tenant)).groupBy(devices.health, devices.connection);
  const fleet = { total: 0, online: 0, degraded: 0, offline: 0 };
  for (const r of fleetRows) {
    fleet.total += r.n;
    if (r.connection === 'offline') fleet.offline += r.n;
    else if (r.health === 'degraded') fleet.degraded += r.n;
    else fleet.online += r.n;
  }
  const rf = await db.select({ status: refunds.status, n: sql<number>`count(*)::int`, amt: sql<number>`coalesce(sum(${refunds.amountMinor}),0)::float8` }).from(refunds).where(eq(refunds.merchantId, tenant)).groupBy(refunds.status);
  const sum = (st?: string) => rf.filter((r) => !st || r.status === st).reduce((a, r) => ({ n: a.n + r.n, amt: a.amt + Number(r.amt) }), { n: 0, amt: 0 });
  const batches = await db.select().from(settlementBatches).where(eq(settlementBatches.merchantId, tenant)).orderBy(sql`${settlementBatches.periodEnd} desc`);
  const open = batches.filter((b) => b.status !== 'paid');
  const next = open.find((b) => b.payoutDate);
  return c.json({
    kpis: { ...base.kpis, activeDevices: fleet.total || base.kpis?.activeDevices || 0 },
    salesTrend: base.salesTrend,
    paymentTypes: base.paymentTypes,
    refunds: { total: sum().n, totalMinor: sum().amt, pendingApproval: sum('pending_approval').n, processed: sum('processed').n, currency: 'ZAR' },
    settlement: {
      status: batches[0]?.reconciliationStatus ?? 'none',
      latestBatchId: batches[0]?.id ?? null,
      pendingNetMinor: open.reduce((a, b) => a + b.netMinor, 0),
      nextPayoutDate: next?.payoutDate?.toISOString() ?? null,
      currency: 'ZAR',
    },
    fleet,
    meta: { source: m?.source ?? 'transaction_journal', version: m?.version ?? 'live', refreshedAt: (m?.refreshedAt ?? new Date()).toISOString() },
  });
});
