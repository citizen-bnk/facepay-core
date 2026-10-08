import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import * as s from './schema';
import { appendAudit } from '../services/audit';
import { reconcile } from '../domain/reconciliation';

export const DEMO_PASSWORD = 'facepay-demo';
const DAY = 86_400_000;

function rng(seed: number) {
  let x = seed;
  return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export async function seed(db: Db, opts: { force?: boolean; now?: Date } = {}): Promise<{ seeded: boolean }> {
  const existing = await db.select({ n: sql<number>`count(*)::int` }).from(s.users);
  if (existing[0]!.n > 0 && !opts.force) return { seeded: false };

  const now = opts.now ?? new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const rand = rng(42);

  // ---- tenants ------------------------------------------------------------
  const tenants = [
    { id: 'tenant_platform', name: 'FacePay Platform', type: 'platform' },
    { id: 'tenant_consumers', name: 'FacePay Consumers', type: 'consumer' },
    { id: 'tenant_abc', name: 'ABC Store', type: 'merchant', legalEntityRef: 'ZA-2019/123456/07', settlementProviderRef: 'sp_mock_abc', category: 'Retail', city: 'Johannesburg', policyId: 'pol_retail_std' },
    { id: 'tenant_pnp', name: 'Pick n Pay', type: 'merchant', legalEntityRef: 'ZA-1981/009678/06', settlementProviderRef: 'sp_mock_pnp', category: 'Grocery', city: 'Cape Town', policyId: 'pol_retail_std' },
    { id: 'tenant_uber', name: 'Uber', type: 'merchant', legalEntityRef: 'ZA-2013/004455/07', settlementProviderRef: 'sp_mock_uber', category: 'Transport', city: 'Johannesburg', policyId: 'pol_transport' },
    { id: 'tenant_bp', name: 'BP Fuel', type: 'merchant', legalEntityRef: 'ZA-1999/017741/07', settlementProviderRef: 'sp_mock_bp', category: 'Fuel', city: 'Durban', policyId: 'pol_fuel' },
    { id: 'tenant_checkers', name: 'Checkers', type: 'merchant', legalEntityRef: 'ZA-1991/003201/06', settlementProviderRef: 'sp_mock_chk', category: 'Grocery', city: 'Pretoria', policyId: 'pol_retail_std' },
    { id: 'tenant_cape', name: 'Cape Coffee Roasters', type: 'merchant', legalEntityRef: 'ZA-2021/777001/07', settlementProviderRef: 'sp_mock_cape', category: 'Food & Hospitality', city: 'Cape Town', policyId: 'pol_retail_std' },
  ];
  await db.insert(s.tenants).values(tenants.map((t) => ({ onboardingState: 'active', ...t })));

  // ---- users --------------------------------------------------------------
  const u = (id: string, tenantId: string, name: string, email: string, role: string, contact?: string) => ({
    id, tenantId, name, email, role, passwordHash: hash, contactRef: contact ?? null, verificationState: 'verified', consentVersion: role === 'customer' ? 'v1.2' : null,
  });
  await db.insert(s.users).values([
    u('usr_thabo', 'tenant_consumers', 'Thabo R', 'thabo@facepay.demo', 'customer', 'cref_+27-**-***-4821'),
    u('usr_naledi', 'tenant_consumers', 'Naledi M', 'naledi@facepay.demo', 'customer', 'cref_+27-**-***-1190'),
    u('usr_sipho', 'tenant_consumers', 'Sipho K', 'sipho@facepay.demo', 'customer', 'cref_+27-**-***-7733'),
    u('usr_aisha', 'tenant_consumers', 'Aisha P', 'aisha@facepay.demo', 'customer', 'cref_+27-**-***-3052'),
    u('usr_pieter', 'tenant_consumers', 'Pieter V', 'pieter@facepay.demo', 'customer', 'cref_+27-**-***-9068'),
    u('usr_abc_owner', 'tenant_abc', 'Lindiwe Dlamini', 'owner@abcstore.demo', 'merchant_owner'),
    u('usr_abc_cashier', 'tenant_abc', 'Kabelo Nkosi', 'cashier@abcstore.demo', 'merchant_cashier'),
    u('usr_cape_owner', 'tenant_cape', 'Marnus Botha', 'owner@capecoffee.demo', 'merchant_owner'),
    u('usr_ops', 'tenant_platform', 'Ops Support', 'ops@facepay.demo', 'support_agent'),
    u('usr_super', 'tenant_platform', 'Pule Phafane', 'super@facepay.demo', 'super_user'),
    u('usr_auditor', 'tenant_platform', 'Audit Reader', 'auditor@facepay.demo', 'auditor'),
    u('usr_finance', 'tenant_platform', 'Finance Operator', 'finance@facepay.demo', 'finance_operator'),
    u('usr_kyc', 'tenant_platform', 'Risk Analyst', 'kyc@facepay.demo', 'kyc_risk_analyst'),
    u('usr_tech', 'tenant_platform', 'Device Technician', 'tech@facepay.demo', 'device_technician'),
    u('usr_integ', 'tenant_platform', 'Integration Operator', 'integrations@facepay.demo', 'integration_operator'),
  ]);

  // ---- wallet, instruments, consents -------------------------------------
  const provider = 'Mock Bank Provider (sandbox)';
  const customers = ['usr_thabo', 'usr_naledi', 'usr_sipho', 'usr_aisha', 'usr_pieter'];
  await db.insert(s.providerAccounts).values(
    customers.map((id, i) => ({ holderId: id, provider, availableBalanceMinor: id === 'usr_thabo' ? 1_245_000 : 350_000 + i * 187_500, currency: 'ZAR', asOf: now })),
  );
  await db.insert(s.paymentInstruments).values([
    { tokenRef: 'tok_thabo_card', providerId: 'mock_bank', type: 'virtual_card', maskedDisplay: 'FacePay Virtual Card •••• 1234', state: 'active', holderId: 'usr_thabo' },
    { tokenRef: 'tok_thabo_acct', providerId: 'mock_bank', type: 'bank_account', maskedDisplay: 'Cheque account •••• 4821', state: 'active', holderId: 'usr_thabo' },
    ...customers.slice(1).map((id) => ({ tokenRef: `tok_${id}_card`, providerId: 'mock_bank', type: 'virtual_card', maskedDisplay: 'FacePay Virtual Card •••• ' + (1000 + Math.floor(rand() * 8999)), state: 'active', holderId: id })),
  ]);
  await db.insert(s.biometricConsents).values([
    { id: 'con_thabo_face', subjectId: 'usr_thabo', modality: 'face', purpose: 'payments', version: 'v1.2', grantedAt: ago(120 * DAY) },
    { id: 'con_thabo_fp', subjectId: 'usr_thabo', modality: 'fingerprint', purpose: 'payments', version: 'v1.2', grantedAt: ago(90 * DAY) },
    { id: 'con_naledi_face', subjectId: 'usr_naledi', modality: 'face', purpose: 'payments', version: 'v1.1', grantedAt: ago(200 * DAY), revokedAt: ago(10 * DAY) },
    { id: 'con_sipho_face', subjectId: 'usr_sipho', modality: 'face', purpose: 'payments', version: 'v1.2', grantedAt: ago(60 * DAY) },
    { id: 'con_aisha_face', subjectId: 'usr_aisha', modality: 'face', purpose: 'payments', version: 'v1.2', grantedAt: ago(45 * DAY) },
    { id: 'con_aisha_palm', subjectId: 'usr_aisha', modality: 'palm', purpose: 'payments', version: 'v1.2', grantedAt: ago(40 * DAY) },
    { id: 'con_pieter_face', subjectId: 'usr_pieter', modality: 'face', purpose: 'payments', version: 'v1.2', grantedAt: ago(30 * DAY) },
  ]);

  // ---- transactions -------------------------------------------------------
  type T = { id: string; merchant: string; customer: string; amount: number; status: string; channel: string; at: Date; intentStatus: string };
  const txns: T[] = [];
  const merchantName = new Map(tenants.map((t) => [t.id, t.name]));
  let n = 0;
  const add = (merchant: string, customer: string, amount: number, status: string, channel: string, at: Date) => {
    n++;
    const intentStatus = status === 'pending' ? 'processing' : status === 'declined' ? 'declined' : status;
    txns.push({ id: `txn_${String(n).padStart(5, '0')}`, merchant, customer, amount, status, channel, at, intentStatus });
  };
  // Thabo's recent activity (matches the mobile app mock)
  const today = new Date(now); today.setHours(14, 32, 0, 0);
  const t2 = new Date(now); t2.setHours(12, 10, 0, 0);
  add('tenant_pnp', 'usr_thabo', 25_000, 'captured', 'face', today.getTime() > now.getTime() ? ago(2 * 3600_000) : today);
  add('tenant_uber', 'usr_thabo', 12_000, 'captured', 'qr', t2.getTime() > now.getTime() ? ago(4 * 3600_000) : t2);
  add('tenant_bp', 'usr_thabo', 80_000, 'captured', 'nfc', ago(DAY + 3 * 3600_000));
  add('tenant_checkers', 'usr_thabo', 34_000, 'captured', 'face', ago(DAY + 6 * 3600_000));
  // ABC Store activity over 30 days
  const channels = ['face', 'face', 'face', 'nfc', 'qr', 'card', 'palm', 'fingerprint'];
  for (let i = 0; i < 36; i++) {
    const cust = customers[Math.floor(rand() * customers.length)]!;
    const amount = Math.round((3_500 + rand() * 38_000) / 100) * 100 + 50;
    const status = i % 17 === 5 ? 'declined' : 'captured';
    add('tenant_abc', cust, amount, status, channels[Math.floor(rand() * channels.length)]!, ago(Math.floor(rand() * 29 * DAY) + 2 * 3600_000));
  }
  add('tenant_abc', 'usr_thabo', 17_200, 'captured', 'face', ago(3 * 3600_000));
  add('tenant_abc', 'usr_sipho', 820_000, 'captured', 'card', ago(2 * DAY)); // large basket, refund demo
  add('tenant_abc', 'usr_aisha', 9_900, 'pending', 'face', ago(10 * 60_000));
  // Other merchants
  for (const m of ['tenant_pnp', 'tenant_pnp', 'tenant_checkers', 'tenant_cape', 'tenant_cape', 'tenant_bp', 'tenant_uber']) {
    add(m, customers[Math.floor(rand() * customers.length)]!, Math.round(2_000 + rand() * 30_000), 'captured', channels[Math.floor(rand() * channels.length)]!, ago(Math.floor(rand() * 20 * DAY) + 3600_000));
  }
  txns.sort((a, b) => a.at.getTime() - b.at.getTime());

  await db.insert(s.paymentIntents).values(txns.map((t) => ({
    id: `pi_${t.id.slice(4)}`, merchantId: t.merchant, amountMinor: t.amount, currency: 'ZAR', status: t.intentStatus,
    idempotencyKey: `seed-${t.id}`, payerId: t.customer, channel: t.channel, createdBy: null,
    providerRef: t.status === 'captured' ? `prov_seed_${t.id.slice(4)}` : null, providerConfirmed: t.status === 'captured',
    declineCode: t.status === 'declined' ? 'insufficient_funds' : null, createdAt: t.at, updatedAt: t.at,
  })));
  await db.insert(s.transactions).values(txns.map((t) => ({
    id: t.id, intentId: `pi_${t.id.slice(4)}`, merchantId: t.merchant, merchantName: merchantName.get(t.merchant)!, customerId: t.customer,
    amountMinor: t.amount, currency: 'ZAR', status: t.status, channel: t.channel,
    providerRef: t.status === 'captured' ? `prov_seed_${t.id.slice(4)}` : null,
    resultCode: t.status === 'captured' ? '00' : t.status === 'declined' ? '51' : null,
    createdAt: t.at, capturedAt: t.status === 'captured' ? t.at : null,
  })));

  // ---- settlements --------------------------------------------------------
  const captured = txns.filter((t) => t.status === 'captured');
  const mkBatch = async (id: string, merchant: string, from: number, to: number, status: string, createdAgoMs: number, payout: Date | null) => {
    const inB = captured.filter((t) => t.merchant === merchant && now.getTime() - t.at.getTime() <= from && now.getTime() - t.at.getTime() > to);
    const gross = inB.reduce((a, t) => a + t.amount, 0);
    const fee = Math.round(gross * 0.015);
    await db.insert(s.settlementBatches).values({
      id, merchantId: merchant, provider, periodStart: ago(from), periodEnd: ago(to), grossMinor: gross, feeMinor: fee, netMinor: gross - fee,
      currency: 'ZAR', status, reconciliationStatus: 'pending', payoutDate: payout, createdAt: ago(createdAgoMs),
    });
    for (const t of inB) await db.update(s.transactions).set({ settlementBatchId: id }).where(sql`${s.transactions.id} = ${t.id}`);
    return inB;
  };
  const lines = async (batch: string, rows: { ref: string; amt: number; cur?: string }[]) => {
    await db.insert(s.settlementLines).values(rows.map((r, i) => ({ id: `${batch}_l${i}`, batchId: batch, providerRef: r.ref, amountMinor: r.amt, currency: r.cur ?? 'ZAR' })));
  };
  const b1 = await mkBatch('stl_abc_1', 'tenant_abc', 31 * DAY, 15 * DAY, 'paid', 14 * DAY, ago(13 * DAY));
  const b2 = await mkBatch('stl_abc_2', 'tenant_abc', 15 * DAY, 7 * DAY, 'closed', 6 * DAY, new Date(now.getTime() + 1 * DAY));
  const b3 = await mkBatch('stl_abc_3', 'tenant_abc', 7 * DAY, 0, 'open', 1 * DAY, new Date(now.getTime() + 6 * DAY));
  for (const [id, b] of [['stl_abc_1', b1], ['stl_abc_2', b2], ['stl_abc_3', b3]] as const) {
    await lines(id, b.map((t) => ({ ref: `prov_seed_${t.id.slice(4)}`, amt: t.amount })));
  }
  // Pick n Pay: stale open batch with deliberate exceptions (duplicate, currency mismatch, gap, unmatched)
  const pnp = await mkBatch('stl_pnp_1', 'tenant_pnp', 21 * DAY, 0, 'open', 5 * DAY, null);
  {
    const rows: { ref: string; amt: number; cur?: string }[] = pnp.map((t) => ({ ref: `prov_seed_${t.id.slice(4)}`, amt: t.amount }));
    rows.push({ ...rows[0]! }); // duplicate line
    if (rows[1]) rows[1] = { ...rows[1], cur: 'USD' }; // currency mismatch
    if (rows.length > 3) rows.splice(2, 1); // gap: ledger entry missing from the file
    rows.push({ ref: 'prov_unknown_9001', amt: 15_500 }); // unmatched settlement line
    await lines('stl_pnp_1', rows);
  }
  for (const b of await db.select().from(s.settlementBatches)) {
    const ls = await db.select().from(s.settlementLines).where(sql`${s.settlementLines.batchId} = ${b.id}`);
    const tx = await db.select().from(s.transactions).where(sql`${s.transactions.settlementBatchId} = ${b.id}`);
    const r = reconcile(
      tx.map((t) => ({ providerRef: t.providerRef!, amountMinor: t.amountMinor, currency: t.currency })),
      ls.map((l) => ({ providerRef: l.providerRef, amountMinor: l.amountMinor, currency: l.currency })),
      { batchCreatedAt: b.createdAt, batchClosed: b.status !== 'open', now },
    );
    await db.update(s.settlementBatches).set({ reconciliationStatus: r.status }).where(sql`${s.settlementBatches.id} = ${b.id}`);
  }

  // ---- refunds ------------------------------------------------------------
  const bigAbc = txns.find((t) => t.amount === 820_000)!;
  const smallAbc = captured.find((t) => t.merchant === 'tenant_abc' && t.amount < 20_000)!;
  await db.insert(s.refunds).values([
    { id: 'rf_0001', transactionId: smallAbc.id, merchantId: 'tenant_abc', amountMinor: 5_000, currency: 'ZAR', reason: 'Item returned', status: 'processed', makerId: 'usr_abc_cashier', checkerId: null, providerRef: 'prov_rf_seed_1', createdAt: ago(5 * DAY), decidedAt: ago(5 * DAY) },
    { id: 'rf_0002', transactionId: bigAbc.id, merchantId: 'tenant_abc', amountMinor: 650_000, currency: 'ZAR', reason: 'Customer returned faulty bundle', status: 'pending_approval', makerId: 'usr_abc_cashier', createdAt: ago(3 * 3600_000) },
  ]);

  // ---- devices ------------------------------------------------------------
  const models = ['FacePay POS with Screen', 'FacePay Tap Module', 'FacePay Kiosk', 'FacePay Handheld'];
  const dev = [];
  for (let i = 1; i <= 12; i++) {
    dev.push({
      id: `dev_abc_${String(i).padStart(2, '0')}`, merchantId: 'tenant_abc', model: models[i % 4]!, serial: `FP-ABC-${1000 + i}`,
      certificateRef: `cert_abc_${i}`, firmware: i === 7 ? '2.3.9' : '2.4.1', health: i === 7 ? 'degraded' : 'healthy', connection: 'online', lastSeenAt: ago(i * 45_000),
    });
  }
  for (let i = 1; i <= 4; i++) dev.push({ id: `dev_cape_${i}`, merchantId: 'tenant_cape', model: models[i % 4]!, serial: `FP-CPT-${2000 + i}`, certificateRef: `cert_cape_${i}`, firmware: '2.4.1', health: 'healthy', connection: i === 4 ? 'offline' : 'online', lastSeenAt: ago(i * 60_000) });
  for (let i = 1; i <= 6; i++) dev.push({ id: `dev_stock_${i}`, merchantId: 'tenant_platform', model: models[i % 4]!, serial: `FP-STK-${3000 + i}`, certificateRef: `cert_stock_${i}`, firmware: '2.4.1', health: 'healthy', connection: 'offline', lastSeenAt: null as any });
  await db.insert(s.devices).values(dev);

  // ---- approvals, integrations, webhooks ---------------------------------
  await db.insert(s.approvals).values([
    { id: 'apr_0001', kind: 'role_grant', subject: 'Grant finance_operator to jane.finance@facepay.demo', justification: 'New month-end reconciliation hire', requestedBy: 'usr_kyc', status: 'pending', expiresAt: new Date(now.getTime() + 3 * DAY), createdAt: ago(5 * 3600_000) },
    { id: 'apr_0002', kind: 'limit_change', subject: 'Raise ABC Store refund approval threshold to R 10,000', justification: 'Merchant request MR-2291, reviewed by finance', requestedBy: 'usr_finance', status: 'pending', expiresAt: new Date(now.getTime() + 2 * DAY), createdAt: ago(9 * 3600_000) },
    { id: 'apr_0003', kind: 'key_rotation', subject: 'Rotate sandbox signing key for Mock Bank Provider', justification: 'Quarterly rotation', requestedBy: 'usr_integ', status: 'approved', decidedBy: 'usr_super', decidedAt: ago(2 * DAY), createdAt: ago(3 * DAY) },
  ]);
  const catalog: [string, string][] = [['E-commerce', 'ecommerce'], ['POS Systems', 'pos'], ['Accounting', 'accounting'], ['Banks & Wallets', 'banks'], ['APIs & SDKs', 'api'], ['QR Payments', 'qr'], ['ERP & SaaS', 'erp'], ['Government', 'government']];
  await db.insert(s.integrations).values([
    ...catalog.map(([name, kind], i) => ({ id: `int_cat_${i + 1}`, tenantId: 'tenant_platform', visibility: 'catalog', name, kind, environment: 'sandbox', status: 'healthy', errorRatePct: 5 + i * 3, lastEventAt: ago((i + 1) * 120_000) })),
    { id: 'int_abc_wh', tenantId: 'tenant_abc', visibility: 'private', name: 'ABC Store webhooks', kind: 'webhook', environment: 'production', status: 'healthy', errorRatePct: 12, keyRotatedAt: ago(40 * DAY), lastEventAt: ago(60_000) },
    { id: 'int_mockbank', tenantId: 'tenant_platform', visibility: 'private', name: 'Mock Bank Provider', kind: 'payment_provider', environment: 'sandbox', status: 'healthy', errorRatePct: 3, keyRotatedAt: ago(2 * DAY), lastEventAt: ago(30_000) },
  ]);

  // ---- metrics (headline numbers from the design images) -----------------
  const series = (base: number, amp: number, k: number) =>
    Array.from({ length: 31 }, (_, i) => Math.round(base + amp * Math.sin(i / 4 + k) + (i * amp) / 10 + rand() * amp * 0.3));
  const dates = Array.from({ length: 31 }, (_, i) => new Date(now.getTime() - (30 - i) * DAY).toISOString().slice(0, 10));
  const vol = series(120_000_000, 40_000_000, 0);
  const volSum = vol.reduce((a, b) => a + b, 0);
  const scale = 4_832_045_000 / volSum;
  const adminTrend = dates.map((d, i) => ({ date: d, volumeMinor: Math.round(vol[i]! * scale), count: Math.round((vol[i]! * scale) / 19_668) }));
  await db.insert(s.metrics).values([
    {
      key: 'admin_overview', scope: 'platform', source: 'transaction_journal', version: 'v1', refreshedAt: now,
      value: {
        kpis: { totalTransactions: 245_680, totalUsers: 245_680, volumeMinor: 4_832_045_000, currency: 'ZAR', averageTransactionMinor: 19_668, activeMerchants: 3_428, activeDevices: 18_204, uptimePct: 99.98, successRatePct: 99.6, deltas: { totalTransactions: 14, activeMerchants: 11, volume: 18, successRate: 0.2 } },
        byChannel: [{ channel: 'face', pct: 48 }, { channel: 'nfc', pct: 22 }, { channel: 'qr', pct: 15 }, { channel: 'card', pct: 10 }, { channel: 'other', pct: 5 }],
        trends: adminTrend,
        incidents: [{ id: 'inc_1', severity: 'low', title: 'Elevated NFC latency (Gauteng)', openedAt: ago(3 * 3600_000).toISOString() }, { id: 'inc_2', severity: 'info', title: 'Provider settlement file delayed 20 min', openedAt: ago(26 * 3600_000).toISOString() }],
      },
    },
    {
      key: 'merchant_dashboard', scope: 'tenant_abc', source: 'transaction_journal', version: 'v1', refreshedAt: now,
      value: {
        kpis: { totalSalesMinor: 24_543_000, totalCustomers: 1_428, averageTransactionMinor: 17_200, activeDevices: 12, currency: 'ZAR', deltas: { totalSales: 12, totalCustomers: 8, averageTransaction: 5, activeDevices: 3 } },
        salesTrend: dates.map((d, i) => ({ date: d, amountMinor: Math.round(series(1_000_000, 500_000, 1)[i]! / 1) })),
        paymentTypes: [{ type: 'face', pct: 48 }, { type: 'nfc', pct: 22 }, { type: 'qr', pct: 15 }, { type: 'card', pct: 10 }, { type: 'other', pct: 5 }],
      },
    },
  ]);

  // ---- audit trail --------------------------------------------------------
  const seedAudit = [
    ['usr_super', 'super_user', 'approval.approve', 'tenant_platform', 'apr_0003'],
    ['usr_abc_cashier', 'merchant_cashier', 'refund.create', 'tenant_abc', 'rf_0001'],
    ['usr_abc_cashier', 'merchant_cashier', 'refund.create', 'tenant_abc', 'rf_0002'],
    ['usr_naledi', 'customer', 'consent.revoke', 'tenant_consumers', 'con_naledi_face'],
  ] as const;
  let i = 0;
  for (const [actorId, actorRole, action, tenantId, objectRef] of seedAudit) {
    await appendAudit(db, { actorId, actorRole, action, tenantId, objectRef, after: { seed: true } }, ago((seedAudit.length - i++) * 3600_000));
  }
  return { seeded: true };
}
