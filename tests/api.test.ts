import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { boot, type Harness } from './helpers';
import { auditEvents, paymentIntents, providerAccounts, transactions, verificationSessions } from '../src/db/schema';
import { verifyChain } from '../src/domain/audit';
import { loadChain } from '../src/services/audit';
import { OPERATIONS } from '../src/api/openapi';

let h: Harness;
beforeAll(async () => { h = await boot(); });

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

async function newIntent(token: string, amountMinor = 10_000, key = crypto.randomUUID()) {
  return h.call('POST', '/v1/payment-intents', { token, body: { merchantId: 'tenant_abc', amountMinor, currency: 'ZAR' }, headers: { 'Idempotency-Key': key } });
}
async function pay(amountMinor: number, subjectId = 'usr_thabo', modality: 'face' | 'pin' = 'face') {
  const cashier = await h.login('cashier@abcstore.demo');
  const pi = (await newIntent(cashier, amountMinor)).json;
  const vs = await h.call('POST', '/v1/verification-sessions', { token: cashier, body: { purpose: 'checkout', paymentIntentId: pi.id, subjectId, modality } });
  const confirm = await h.call('POST', `/v1/payment-intents/${pi.id}/confirm`, { token: cashier, body: { verificationSessionId: vs.json.id } });
  return { cashier, pi, vs, confirm };
}

describe('auth and contract surface', () => {
  it('logs in all demo users and rejects bad credentials', async () => {
    for (const e of ['thabo@facepay.demo', 'owner@abcstore.demo', 'cashier@abcstore.demo', 'ops@facepay.demo', 'super@facepay.demo', 'auditor@facepay.demo']) {
      const r = await h.call('POST', '/v1/auth/login', { body: { email: e, password: 'facepay-demo' } });
      expect(r.status).toBe(200);
      expect(r.json.user.email).toBe(e);
      expect(r.json.token).toBeTruthy();
    }
    const bad = await h.call('POST', '/v1/auth/login', { body: { email: 'thabo@facepay.demo', password: 'nope' } });
    expect(bad.status).toBe(401);
    expect(bad.json.error.code).toBe('invalid_credentials');
  });
  it('requires a valid token', async () => {
    expect((await h.call('GET', '/v1/wallet')).status).toBe(401);
    expect((await h.call('GET', '/v1/wallet', { token: 'garbage' })).status).toBe(401);
  });
  it('serves OpenAPI covering every route, and docs at /', async () => {
    const spec = await h.call('GET', '/v1/openapi.json');
    expect(spec.status).toBe(200);
    for (const o of OPERATIONS) expect(spec.json.paths[o.path]?.[o.m], `${o.m} ${o.path}`).toBeTruthy();
    const registered = h.app.routes.filter((r) => r.path.startsWith('/v1/') && r.method !== 'ALL').map((r) => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, '{$1}')}`);
    const documented = new Set(OPERATIONS.map((o) => `${o.m} ${o.path}`));
    for (const r of new Set(registered)) expect(documented.has(r), r).toBe(true);
    const docs = await h.call('GET', '/');
    expect(docs.status).toBe(200);
    expect(docs.text).toContain('FacePay');
  });
  it('wallet shows provider-sourced balance R 12,450.00 and recent merchants', async () => {
    const t = await h.login('thabo@facepay.demo');
    const w = await h.call('GET', '/v1/wallet', { token: t });
    expect(w.status).toBe(200);
    expect(w.json.availableBalanceMinor).toBe(1_245_000);
    expect(w.json.currency).toBe('ZAR');
    expect(w.json.balanceSource).toBe('provider');
    expect(w.json.methods.length).toBeGreaterThan(0);
    const names = (await h.call('GET', '/v1/transactions?limit=10', { token: t })).json.items.map((i: any) => i.merchantName);
    for (const n of ['Pick n Pay', 'Uber', 'BP Fuel', 'Checkers']) expect(names).toContain(n);
  });
  it('paginates and filters transactions', async () => {
    const o = await h.login('owner@abcstore.demo');
    const p1 = await h.call('GET', '/v1/transactions?limit=5', { token: o });
    expect(p1.json.items).toHaveLength(5);
    expect(p1.json.nextCursor).toBeTruthy();
    const p2 = await h.call('GET', `/v1/transactions?limit=5&cursor=${p1.json.nextCursor}`, { token: o });
    expect(p2.json.items[0].id).not.toBe(p1.json.items[0].id);
    const dec = await h.call('GET', '/v1/transactions?status=declined', { token: o });
    for (const i of dec.json.items) expect(i.status).toBe('declined');
    expect((await h.call('GET', '/v1/transactions?status=bogus', { token: o })).status).toBe(422);
  });
  it('admin overview and merchant dashboard return the headline KPIs', async () => {
    const a = await h.call('GET', '/v1/admin/overview', { token: await h.login('super@facepay.demo') });
    expect(a.json.kpis.totalTransactions).toBe(245_680);
    expect(a.json.kpis.volumeMinor).toBe(4_832_045_000);
    expect(a.json.meta.refreshedAt).toBeTruthy();
    const m = await h.call('GET', '/v1/merchant/dashboard', { token: await h.login('owner@abcstore.demo') });
    expect(m.json.kpis.activeDevices).toBe(12);
    expect(m.json.fleet.total).toBe(12);
    expect((await h.call('GET', '/v1/admin/overview', { token: await h.login('owner@abcstore.demo') })).status).toBe(403);
  });
});

describe('cross-tenant denial', () => {
  it('blocks reading another tenant data and creating intents for it', async () => {
    const cape = await h.login('owner@capecoffee.demo');
    const abc = await h.login('owner@abcstore.demo');
    const abcTxn = (await h.call('GET', '/v1/transactions?limit=1', { token: abc })).json.items[0];
    expect((await h.call('GET', `/v1/transactions/${abcTxn.id}`, { token: cape })).status).toBe(404);
    const capeList = (await h.call('GET', '/v1/transactions?limit=100', { token: cape })).json.items;
    expect(capeList.every((t: any) => t.merchantId === 'tenant_cape')).toBe(true);
    expect((await h.call('GET', '/v1/merchants/tenant_abc', { token: cape })).status).toBe(404);
    expect((await h.call('GET', '/v1/devices', { token: cape })).json.items.every((d: any) => d.merchantId === 'tenant_cape')).toBe(true);
    const r = await h.call('POST', '/v1/payment-intents', { token: cape, body: { merchantId: 'tenant_abc', amountMinor: 100, currency: 'ZAR' }, headers: idem() });
    expect(r.status).toBe(403);
    const pi = (await newIntent(abc)).json;
    expect((await h.call('GET', `/v1/payment-intents/${pi.id}`, { token: cape })).status).toBe(404);
    expect((await h.call('POST', `/v1/payment-intents/${pi.id}/confirm`, { token: cape, body: {} })).status).toBe(404);
    const rf = await h.call('POST', '/v1/refunds', { token: cape, body: { transactionId: abcTxn.id, amountMinor: 100, reason: 'cross tenant attempt' } });
    expect(rf.status).toBe(404);
  });
  it("a customer cannot see another customer's transactions", async () => {
    const t = await h.login('thabo@facepay.demo');
    const abc = await h.login('owner@abcstore.demo');
    const other = (await h.call('GET', '/v1/transactions?limit=100', { token: abc })).json.items.find((i: any) => true);
    const row = await h.ctx.db.select().from(transactions).where(eq(transactions.customerId, 'usr_naledi')).limit(1);
    expect((await h.call('GET', `/v1/transactions/${row[0]!.id}`, { token: t })).status).toBe(404);
    void other;
  });
});

describe('payment intents: idempotency and provider confirmation', () => {
  it('same Idempotency-Key returns the same intent with no duplicate effect', async () => {
    const cashier = await h.login('cashier@abcstore.demo');
    const key = crypto.randomUUID();
    const a = await newIntent(cashier, 12_300, key);
    const b = await newIntent(cashier, 12_300, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.json.id).toBe(a.json.id);
    expect(b.headers.get('Idempotent-Replayed')).toBe('true');
    const rows = await h.ctx.db.select().from(paymentIntents).where(eq(paymentIntents.idempotencyKey, key));
    expect(rows).toHaveLength(1);
    const diff = await newIntent(cashier, 99_900, key);
    expect(diff.status).toBe(422);
    expect(diff.json.error.code).toBe('idempotency_key_reuse');
  });
  it('requires an Idempotency-Key', async () => {
    const cashier = await h.login('cashier@abcstore.demo');
    const r = await h.call('POST', '/v1/payment-intents', { token: cashier, body: { merchantId: 'tenant_abc', amountMinor: 100, currency: 'ZAR' } });
    expect(r.status).toBe(400);
  });
  it('retrying confirm never double-debits', async () => {
    const before = (await h.ctx.db.select().from(providerAccounts).where(eq(providerAccounts.holderId, 'usr_thabo')))[0]!.availableBalanceMinor;
    const { cashier, pi, vs, confirm } = await pay(25_000);
    expect(confirm.status).toBe(200);
    expect(confirm.json.status).toBe('captured');
    expect(confirm.json.paid).toBe(true);
    const again = await h.call('POST', `/v1/payment-intents/${pi.id}/confirm`, { token: cashier, body: { verificationSessionId: vs.json.id } });
    expect(again.json.status).toBe('captured');
    const after = (await h.ctx.db.select().from(providerAccounts).where(eq(providerAccounts.holderId, 'usr_thabo')))[0]!.availableBalanceMinor;
    expect(before - after).toBe(25_000);
  });
  it('concurrent confirms produce a single capture', async () => {
    const before = (await h.ctx.db.select().from(providerAccounts).where(eq(providerAccounts.holderId, 'usr_thabo')))[0]!.availableBalanceMinor;
    const cashier = await h.login('cashier@abcstore.demo');
    const pi = (await newIntent(cashier, 11_100)).json;
    const vs = await h.call('POST', '/v1/verification-sessions', { token: cashier, body: { purpose: 'checkout', paymentIntentId: pi.id, subjectId: 'usr_thabo' } });
    await Promise.all([1, 2, 3].map(() => h.call('POST', `/v1/payment-intents/${pi.id}/confirm`, { token: cashier, body: { verificationSessionId: vs.json.id } })));
    const after = (await h.ctx.db.select().from(providerAccounts).where(eq(providerAccounts.holderId, 'usr_thabo')))[0]!.availableBalanceMinor;
    expect(before - after).toBe(11_100);
  });
  it('is never captured/paid without provider confirmation (timeout, pending capture, decline)', async () => {
    const timeout = await pay(10_998);
    expect(timeout.confirm.json.status).toBe('processing');
    expect(timeout.confirm.json.paid).toBe(false);
    const pendingCapture = await pay(10_997);
    expect(pendingCapture.confirm.json.status).toBe('authorised');
    expect(pendingCapture.confirm.json.paid).toBe(false);
    const declined = await pay(10_999);
    expect(declined.confirm.json.status).toBe('declined');
    expect(declined.confirm.json.paid).toBe(false);
    const txn = (await h.call('GET', `/v1/transactions/${timeout.pi.transactionId}`, { token: timeout.cashier })).json;
    expect(txn.status).toBe('pending');
    const wallet = await h.call('GET', '/v1/wallet', { token: await h.login('thabo@facepay.demo') });
    expect(wallet.json.provider).toContain('Provider');
  });
  it('requires a verified step-up session and rejects expired intents', async () => {
    const cashier = await h.login('cashier@abcstore.demo');
    const pi = (await newIntent(cashier)).json;
    expect((await h.call('POST', `/v1/payment-intents/${pi.id}/confirm`, { token: cashier, body: {} })).json.error.code).toBe('verification_required');
    const failed = await h.call('POST', '/v1/verification-sessions', { token: cashier, body: { purpose: 'checkout', paymentIntentId: pi.id, subjectId: 'usr_thabo', simulate: 'liveness_failed' } });
    expect(failed.json.status).toBe('failed');
    expect((await h.call('POST', `/v1/payment-intents/${pi.id}/confirm`, { token: cashier, body: { verificationSessionId: failed.json.id } })).json.error.code).toBe('verification_failed');
    await h.ctx.db.update(paymentIntents).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(paymentIntents.id, pi.id));
    const vs = await h.call('POST', '/v1/verification-sessions', { token: cashier, body: { purpose: 'checkout', subjectId: 'usr_thabo' } });
    const exp = await h.call('POST', `/v1/payment-intents/${pi.id}/confirm`, { token: cashier, body: { verificationSessionId: vs.json.id } });
    expect(exp.status).toBe(409);
    expect((await h.call('GET', `/v1/payment-intents/${pi.id}`, { token: cashier })).json.status).toBe('expired');
  });
});

describe('refunds maker/checker', () => {
  it('over-threshold refund needs a distinct checker and is audited', async () => {
    const cashier = await h.login('cashier@abcstore.demo');
    const owner = await h.login('owner@abcstore.demo');
    await h.ctx.db.update(providerAccounts).set({ availableBalanceMinor: 5_000_000 }).where(eq(providerAccounts.holderId, 'usr_sipho'));
    const big2 = await pay(600_000, 'usr_sipho');
    expect(big2.confirm.json.status).toBe('captured');
    const created = await h.call('POST', '/v1/refunds', { token: owner, body: { transactionId: big2.pi.transactionId, amountMinor: 600_000, reason: 'Goods not delivered' } });
    expect(created.status).toBe(201);
    expect(created.json.status).toBe('pending_approval');
    const self = await h.call('POST', `/v1/refunds/${created.json.id}/approve`, { token: owner, body: {} });
    expect(self.status).toBe(403);
    expect(self.json.error.code).toBe('maker_checker_violation');
    expect((await h.call('POST', `/v1/refunds/${created.json.id}/approve`, { token: cashier, body: {} })).status).toBe(403);
    const ok = await h.call('POST', `/v1/refunds/${created.json.id}/approve`, { token: await h.login('super@facepay.demo'), body: {} });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('processed');
    expect(ok.json.checkerId).toBe('usr_super');
    expect((await h.call('GET', `/v1/transactions/${big2.pi.transactionId}`, { token: owner })).json.status).toBe('refunded');
    const log = await h.call('GET', '/v1/audit-events?limit=100', { token: await h.login('auditor@facepay.demo') });
    const actions = log.json.items.map((e: any) => `${e.action}:${e.objectRef}`);
    expect(actions).toContain(`refund.create:${created.json.id}`);
    expect(actions).toContain(`refund.approve:${created.json.id}`);
    expect(log.json.chain.ok).toBe(true);
  });
  it('seeded pending refund created by cashier can be approved by owner, rejection works, small refunds auto-process', async () => {
    const owner = await h.login('owner@abcstore.demo');
    const ok = await h.call('POST', '/v1/refunds/rf_0002/approve', { token: owner, body: {} });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('processed');
    expect((await h.call('POST', '/v1/refunds/rf_0002/approve', { token: owner, body: {} })).status).toBe(409);
    const t = await pay(120_000, 'usr_thabo');
    const small = await h.call('POST', '/v1/refunds', { token: owner, body: { transactionId: t.pi.transactionId, amountMinor: 40_000, reason: 'Partial return' } });
    expect(small.json.status).toBe('processed');
    const over = await h.call('POST', '/v1/refunds', { token: owner, body: { transactionId: t.pi.transactionId, amountMinor: 120_000, reason: 'Too much' } });
    expect(over.status).toBe(422);
    const cashierBig = await h.call('POST', '/v1/refunds', { token: t.cashier, body: { transactionId: t.pi.transactionId, amountMinor: 60_000, reason: 'Above cashier limit' } });
    expect(cashierBig.json.status).toBe('pending_approval');
    const rej = await h.call('POST', `/v1/refunds/${cashierBig.json.id}/reject`, { token: owner, body: { note: 'no' } });
    expect(rej.json.status).toBe('rejected');
  });
  it('cannot refund an uncaptured transaction', async () => {
    const owner = await h.login('owner@abcstore.demo');
    const pi = (await newIntent(await h.login('cashier@abcstore.demo'))).json;
    const r = await h.call('POST', '/v1/refunds', { token: owner, body: { transactionId: pi.transactionId, amountMinor: 100, reason: 'nothing captured' } });
    expect(r.status).toBe(409);
  });
});

describe('consent revocation', () => {
  it('blocks biometric challenges after revocation but allows PIN', async () => {
    const thabo = await h.login('thabo@facepay.demo');
    const cashier = await h.login('cashier@abcstore.demo');
    const consents = (await h.call('GET', '/v1/consents', { token: thabo })).json.items;
    expect(consents.length).toBeGreaterThan(0);
    const ok = await h.call('POST', '/v1/verification-sessions', { token: cashier, body: { purpose: 'checkout', subjectId: 'usr_thabo', modality: 'face' } });
    expect(ok.status).toBe(201);
    // Intent verified before revocation, confirmed after => must be blocked too.
    const pi = (await newIntent(cashier, 5_000)).json;
    const early = await h.call('POST', '/v1/verification-sessions', { token: cashier, body: { purpose: 'checkout', paymentIntentId: pi.id, subjectId: 'usr_thabo', modality: 'face' } });
    const face = consents.find((c: any) => c.modality === 'face');
    const rev = await h.call('POST', `/v1/consents/${face.id}/revoke`, { token: thabo });
    expect(rev.status).toBe(200);
    expect(rev.json.status).toBe('revoked');
    const blocked = await h.call('POST', '/v1/verification-sessions', { token: cashier, body: { purpose: 'checkout', subjectId: 'usr_thabo', modality: 'face' } });
    expect(blocked.status).toBe(403);
    expect(blocked.json.error.code).toBe('consent_required');
    const late = await h.call('POST', `/v1/payment-intents/${pi.id}/confirm`, { token: cashier, body: { verificationSessionId: early.json.id } });
    expect(late.status).toBe(403);
    const pin = await h.call('POST', '/v1/verification-sessions', { token: cashier, body: { purpose: 'checkout', subjectId: 'usr_thabo', modality: 'pin' } });
    expect(pin.status).toBe(201);
    // Naledi's seeded revoked consent
    expect((await h.call('POST', '/v1/verification-sessions', { token: cashier, body: { purpose: 'checkout', subjectId: 'usr_naledi' } })).status).toBe(403);
    // customers cannot revoke someone else's consent
    expect((await h.call('POST', '/v1/consents/con_sipho_face/revoke', { token: thabo })).status).toBe(404);
  });
});

describe('support cannot read biometrics', () => {
  it('exposes no biometric data and denies raw access', async () => {
    const ops = await h.login('ops@facepay.demo');
    const customers = await h.call('GET', '/v1/customers', { token: ops });
    expect(customers.status).toBe(200);
    const blob = JSON.stringify(customers.json).toLowerCase();
    for (const bad of ['template', 'embedding', 'image', 'vendor', 'vnd_', 'faceprint', 'raw']) expect(blob).not.toContain(bad);
    expect(customers.json.items[0].name).toMatch(/\*/);
    expect(customers.json.items[0].email).toMatch(/\*\*\*@/);
    for (const role of ['ops@facepay.demo', 'super@facepay.demo', 'auditor@facepay.demo', 'owner@abcstore.demo']) {
      const r = await h.call('GET', '/v1/customers/usr_thabo/biometric-media', { token: await h.login(role) });
      expect(r.status).toBe(403);
    }
    expect((await h.call('POST', '/v1/verification-sessions', { token: ops, body: { purpose: 'checkout', subjectId: 'usr_thabo' } })).status).toBe(403);
    const consents = JSON.stringify((await h.call('GET', '/v1/consents', { token: ops })).json);
    expect(consents).not.toContain('Thabo R');
    // storage never holds anything but opaque refs
    const vs = await h.ctx.db.select().from(verificationSessions);
    for (const v of vs) if (v.vendorRef) expect(v.vendorRef).toMatch(/^vnd_[0-9a-f]+$/);
  });
});

describe('reconciliation via API', () => {
  it('flags duplicates, gaps, currency mismatches and stale batches for the seeded Pick n Pay batch', async () => {
    const fin = await h.login('finance@facepay.demo');
    const r = await h.call('GET', '/v1/settlements', { token: fin });
    expect(r.status).toBe(200);
    const pnp = r.json.items.find((b: any) => b.id === 'stl_pnp_1');
    expect(pnp.reconciliationStatus).toBe('exceptions');
    const kinds = pnp.reconciliation.exceptions.map((e: any) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['duplicate', 'currency_mismatch', 'unmatched', 'stale_batch']));
    const abc = r.json.items.find((b: any) => b.id === 'stl_abc_1');
    expect(abc.reconciliationStatus).toBe('reconciled');
    const ownerView = await h.call('GET', '/v1/settlements', { token: await h.login('owner@abcstore.demo') });
    expect(ownerView.json.items.every((b: any) => b.merchantId === 'tenant_abc')).toBe(true);
    expect((await h.call('GET', '/v1/settlements', { token: await h.login('cashier@abcstore.demo') })).status).toBe(403);
  });
});

describe('devices, approvals, misc endpoints', () => {
  it('enrols a device idempotently and enforces tenant', async () => {
    const owner = await h.login('owner@abcstore.demo');
    const key = crypto.randomUUID();
    const body = { model: 'FacePay Tap Module', serial: 'FP-TEST-0001' };
    const a = await h.call('POST', '/v1/devices/enrol', { token: owner, body, headers: { 'Idempotency-Key': key } });
    const b = await h.call('POST', '/v1/devices/enrol', { token: owner, body, headers: { 'Idempotency-Key': key } });
    expect(a.status).toBe(201);
    expect(b.json.id).toBe(a.json.id);
    expect((await h.call('POST', '/v1/devices/enrol', { token: owner, body: { ...body, serial: 'X-1234', merchantId: 'tenant_cape' } })).status).toBe(403);
    expect((await h.call('GET', '/v1/devices', { token: owner })).json.items).toHaveLength(13);
  });
  it('dual approval: requester cannot approve; super user can', async () => {
    const sup = await h.login('super@facepay.demo');
    expect((await h.call('POST', '/v1/approvals/apr_0001/approve', { token: await h.login('kyc@facepay.demo') })).status).toBe(403);
    const ok = await h.call('POST', '/v1/approvals/apr_0001/approve', { token: sup });
    expect(ok.json.status).toBe('approved');
    expect((await h.call('POST', '/v1/approvals/apr_0001/deny', { token: sup })).status).toBe(409);
    expect((await h.call('GET', '/v1/roles', { token: sup })).json.items).toHaveLength(10);
  });
  it('webhook secret is shown once; leads accepted publicly; integrations list', async () => {
    const owner = await h.login('owner@abcstore.demo');
    const w = await h.call('POST', '/v1/webhooks/subscriptions', { token: owner, body: { url: 'https://example.com/hook', events: ['payment.captured'] } });
    expect(w.status).toBe(201);
    expect(w.json.secret).toMatch(/^whsec_/);
    expect((await h.call('POST', '/v1/webhooks/subscriptions', { token: owner, body: { url: 'http://insecure.example.com', events: ['x'] } })).status).toBe(422);
    const lead = await h.call('POST', '/v1/leads', { body: { name: 'Zed', company: 'Z', email: 'z@example.com', message: 'hi', kind: 'demo' } });
    expect(lead.status).toBe(201);
    expect((await h.call('POST', '/v1/leads', { body: { name: 'Zed', email: 'bad', kind: 'demo' } })).status).toBe(422);
    expect((await h.call('GET', '/v1/integrations', { token: owner })).json.items.length).toBeGreaterThan(0);
    expect((await h.call('GET', '/v1/merchants', { token: await h.login('ops@facepay.demo') })).json.items.length).toBeGreaterThan(3);
  });
  it('CORS only allows listed origins', async () => {
    process.env.ALLOWED_ORIGINS = 'https://app.facepay.com, https://portal.facepay.com';
    const ok = await h.app.request('/v1/health', { headers: { Origin: 'https://portal.facepay.com' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://portal.facepay.com');
    const no = await h.app.request('/v1/health', { headers: { Origin: 'https://evil.example' } });
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
    delete process.env.ALLOWED_ORIGINS;
  });
});

describe('audit log integrity', () => {
  it('chain verifies, and the database refuses updates and deletes', async () => {
    expect(verifyChain(await loadChain(h.ctx.db)).ok).toBe(true);
    await expect(h.ctx.db.update(auditEvents).set({ action: 'tampered' }).where(eq(auditEvents.seq, 1))).rejects.toThrow();
    await expect(h.ctx.db.delete(auditEvents).where(eq(auditEvents.seq, 1))).rejects.toThrow();
  });
});
