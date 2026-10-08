import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { biometricConsents, devices, settlementBatches, settlementLines, tenants, transactions, users } from '../../db/schema.js';
import { reconcile } from '../../domain/reconciliation.js';
import { DomainError, ROLE_MATRIX, canReadRawBiometrics } from '../../domain/rbac.js';
import { isActive } from '../../domain/consent.js';
import { appendAudit } from '../../services/audit.js';
import { maskEmail, maskName } from '../../services/serialize.js';
import { withIdempotency } from '../idempotency.js';
import { jsonBody, parse, requirePerm, type Env } from '../http.js';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../../context.js';

export const opsRoutes = new Hono<Env>();

// ---- settlements ----------------------------------------------------------
opsRoutes.get('/v1/settlements', async (c) => {
  const p = requirePerm(c, 'settlements:read');
  const { db } = c.get('app');
  const scope = ROLE_MATRIX[p.role].scope;
  const batches = await db
    .select({ b: settlementBatches, merchantName: tenants.name })
    .from(settlementBatches)
    .innerJoin(tenants, eq(tenants.id, settlementBatches.merchantId))
    .where(scope === 'platform' ? undefined : eq(settlementBatches.merchantId, p.tenantId))
    .orderBy(desc(settlementBatches.periodEnd));
  const ids = batches.map((r) => r.b.id);
  const lines = ids.length ? await db.select().from(settlementLines).where(inArray(settlementLines.batchId, ids)) : [];
  const txns = ids.length ? await db.select().from(transactions).where(inArray(transactions.settlementBatchId, ids)) : [];
  const items = batches.map(({ b, merchantName }) => {
    const r = reconcile(
      txns.filter((t) => t.settlementBatchId === b.id && t.providerRef).map((t) => ({ providerRef: t.providerRef!, amountMinor: t.amountMinor, currency: t.currency })),
      lines.filter((l) => l.batchId === b.id).map((l) => ({ providerRef: l.providerRef, amountMinor: l.amountMinor, currency: l.currency })),
      { batchCreatedAt: b.createdAt, batchClosed: b.status !== 'open' },
    );
    return {
      id: b.id, merchantId: b.merchantId, merchantName, provider: b.provider, periodStart: b.periodStart.toISOString(), periodEnd: b.periodEnd.toISOString(),
      grossMinor: b.grossMinor, feeMinor: b.feeMinor, netMinor: b.netMinor, currency: b.currency, status: b.status,
      reconciliationStatus: r.status, payoutDate: b.payoutDate?.toISOString() ?? null,
      reconciliation: { matched: r.matched, exceptions: r.exceptions },
    };
  });
  if (c.req.query('format') === 'csv') {
    const head = 'id,merchantId,periodStart,periodEnd,grossMinor,feeMinor,netMinor,currency,status,reconciliationStatus';
    const csv = [head, ...items.map((i) => [i.id, i.merchantId, i.periodStart, i.periodEnd, i.grossMinor, i.feeMinor, i.netMinor, i.currency, i.status, i.reconciliationStatus].join(','))].join('\n');
    return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8' });
  }
  return c.json({ items });
});

// ---- devices --------------------------------------------------------------
const publicDevice = (d: typeof devices.$inferSelect) => ({
  id: d.id, merchantId: d.merchantId, model: d.model, serial: d.serial, firmware: d.firmware, health: d.health, connection: d.connection,
  certificateRef: d.certificateRef, lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
});

opsRoutes.get('/v1/devices', async (c) => {
  const p = requirePerm(c, 'devices:read');
  const { db } = c.get('app');
  const scope = ROLE_MATRIX[p.role].scope;
  const rows = await db.select().from(devices).where(scope === 'platform' ? undefined : eq(devices.merchantId, p.tenantId)).orderBy(devices.id);
  return c.json({ items: rows.map(publicDevice) });
});

const Enrol = z.object({
  merchantId: z.string().max(64).optional(),
  model: z.string().min(2).max(80),
  serial: z.string().min(3).max(64),
  certificateRef: z.string().min(3).max(128).optional(),
  firmware: z.string().max(32).optional(),
});

opsRoutes.post('/v1/devices/enrol', async (c) => {
  const p = requirePerm(c, 'devices:enrol');
  const body = parse(Enrol, await jsonBody(c));
  const app = c.get('app');
  const platform = ROLE_MATRIX[p.role].scope === 'platform';
  const merchantId = platform ? body.merchantId : p.tenantId;
  if (!merchantId) throw new DomainError(422, 'validation_error', 'merchantId is required');
  if (!platform && body.merchantId && body.merchantId !== p.tenantId) throw new DomainError(403, 'cross_tenant_denied', 'Cannot enrol devices for another merchant');
  return withIdempotency(c, body, { required: false }, async () => {
    const [m] = await app.db.select().from(tenants).where(eq(tenants.id, merchantId));
    if (!m) throw new DomainError(404, 'merchant_not_found', 'Merchant not found');
    const [dup] = await app.db.select().from(devices).where(eq(devices.serial, body.serial));
    if (dup) throw new DomainError(409, 'device_exists', 'A device with this serial is already enrolled');
    const [d] = await app.db.insert(devices).values({
      id: `dev_${randomUUID().replace(/-/g, '').slice(0, 12)}`, merchantId, model: body.model, serial: body.serial,
      certificateRef: body.certificateRef ?? `cert_${randomUUID().slice(0, 8)}`, firmware: body.firmware ?? '2.4.1', health: 'healthy', connection: 'online', lastSeenAt: new Date(),
    }).returning();
    await appendAudit(app.db, { actorId: p.id, actorRole: p.role, action: 'device.enrol', tenantId: merchantId, objectRef: d!.id, after: { serial: body.serial, model: body.model } });
    return { status: 201, body: publicDevice(d!) };
  });
});

// ---- merchants ------------------------------------------------------------
async function merchantView(app: AppContext, rows: (typeof tenants.$inferSelect)[], mask: boolean) {
  const counts = await app.db.select({ id: devices.merchantId, n: sql<number>`count(*)::int` }).from(devices).groupBy(devices.merchantId);
  const cm = new Map(counts.map((r) => [r.id, r.n]));
  return rows.map((t) => ({
    id: t.id, name: t.name, legalEntityRef: t.legalEntityRef, onboardingState: t.onboardingState, category: t.category, city: t.city,
    settlementProviderRef: mask && t.settlementProviderRef ? '••••' + t.settlementProviderRef.slice(-4) : t.settlementProviderRef,
    policyId: t.policyId, deviceCount: cm.get(t.id) ?? 0,
  }));
}

opsRoutes.get('/v1/merchants', async (c) => {
  const p = requirePerm(c, 'merchants:read');
  const app = c.get('app');
  const scope = ROLE_MATRIX[p.role].scope;
  const rows = await app.db.select().from(tenants).where(and(eq(tenants.type, 'merchant'), scope === 'platform' ? undefined : eq(tenants.id, p.tenantId))).orderBy(tenants.name);
  return c.json({ items: await merchantView(app, rows, p.role === 'merchant_cashier') });
});

opsRoutes.get('/v1/merchants/:id', async (c) => {
  const p = requirePerm(c, 'merchants:read');
  const app = c.get('app');
  const scope = ROLE_MATRIX[p.role].scope;
  const id = c.req.param('id');
  if (scope !== 'platform' && id !== p.tenantId) throw new DomainError(404, 'not_found', 'Merchant not found');
  const [t] = await app.db.select().from(tenants).where(and(eq(tenants.id, id), eq(tenants.type, 'merchant')));
  if (!t) throw new DomainError(404, 'not_found', 'Merchant not found');
  return c.json((await merchantView(app, [t], p.role === 'merchant_cashier'))[0]);
});

// ---- customers (masked) ---------------------------------------------------
opsRoutes.get('/v1/customers', async (c) => {
  const p = requirePerm(c, 'customers:read');
  const { db } = c.get('app');
  const scope = ROLE_MATRIX[p.role].scope;
  let rows = await db.select().from(users).where(eq(users.role, 'customer')).orderBy(users.name);
  if (scope === 'tenant') {
    const mine = await db.selectDistinct({ id: transactions.customerId }).from(transactions).where(eq(transactions.merchantId, p.tenantId));
    const set = new Set(mine.map((m) => m.id));
    rows = rows.filter((r) => set.has(r.id));
  }
  const consents = await db.select().from(biometricConsents);
  return c.json({
    items: rows.map((u) => {
      const cs = consents.filter((x) => x.subjectId === u.id);
      return {
        id: u.id, name: maskName(u.name), email: maskEmail(u.email), contact: u.contactRef ? u.contactRef.replace(/^cref_/, '') : null,
        verificationState: u.verificationState,
        // Consent flag only; never any biometric data.
        biometricConsent: cs.some((x) => isActive(x)) ? 'active' : cs.length ? 'revoked' : 'none',
        createdAt: u.createdAt.toISOString(),
      };
    }),
  });
});

/** Deliberately unavailable to every role. Exists so attempts are denied and audited consistently. */
opsRoutes.get('/v1/customers/:id/biometric-media', async (c) => {
  const p = c.get('principal');
  const app = c.get('app');
  await appendAudit(app.db, { actorId: p.id, actorRole: p.role, action: 'biometrics.raw_access_denied', tenantId: p.tenantId, objectRef: c.req.param('id') });
  void canReadRawBiometrics(p);
  throw new DomainError(403, 'biometrics_not_available', 'Raw biometric media and templates are not accessible through any API');
});

// ---- consents ---------------------------------------------------------------
const publicConsent = (k: typeof biometricConsents.$inferSelect, name?: string) => ({
  id: k.id, subjectId: k.subjectId, subjectName: name, modality: k.modality, purpose: k.purpose, legalBasis: k.legalBasis, version: k.version,
  grantedAt: k.grantedAt.toISOString(), revokedAt: k.revokedAt?.toISOString() ?? null, status: isActive(k) ? 'active' : 'revoked',
});

opsRoutes.get('/v1/consents', async (c) => {
  const p = requirePerm(c, 'consents:read');
  const { db } = c.get('app');
  const scope = ROLE_MATRIX[p.role].scope;
  const rows = await db.select({ k: biometricConsents, name: users.name }).from(biometricConsents).innerJoin(users, eq(users.id, biometricConsents.subjectId)).where(scope === 'own' ? eq(biometricConsents.subjectId, p.id) : undefined).orderBy(desc(biometricConsents.grantedAt));
  return c.json({ items: rows.map((r) => publicConsent(r.k, scope === 'own' ? r.name : maskName(r.name))) });
});

opsRoutes.post('/v1/consents/:id/revoke', async (c) => {
  const p = requirePerm(c, 'consents:revoke');
  const app = c.get('app');
  const [k] = await app.db.select().from(biometricConsents).where(and(eq(biometricConsents.id, c.req.param('id')), eq(biometricConsents.subjectId, p.id)));
  if (!k) throw new DomainError(404, 'not_found', 'Consent not found');
  if (k.revokedAt) return c.json(publicConsent(k)); // idempotent
  const [row] = await app.db.update(biometricConsents).set({ revokedAt: new Date() }).where(eq(biometricConsents.id, k.id)).returning();
  const remaining = await app.db.select().from(biometricConsents).where(eq(biometricConsents.subjectId, p.id));
  if (!remaining.some((x) => isActive(x))) await app.providers.biometrics.deleteSubject(p.id);
  await appendAudit(app.db, { actorId: p.id, actorRole: p.role, action: 'consent.revoke', tenantId: p.tenantId, objectRef: k.id, before: { revokedAt: null }, after: { revokedAt: row!.revokedAt } });
  return c.json(publicConsent(row!));
});
