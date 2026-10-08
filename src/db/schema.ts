import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' });

/** Tenant / merchant. Merchant id == tenant id. */
export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // platform | consumer | merchant
  legalEntityRef: text('legal_entity_ref'),
  onboardingState: text('onboarding_state').notNull().default('active'),
  settlementProviderRef: text('settlement_provider_ref'),
  policyId: text('policy_id'),
  category: text('category'),
  city: text('city'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  contactRef: text('contact_ref'), // opaque/masked contact reference, never raw phone
  verificationState: text('verification_state').notNull().default('verified'),
  consentVersion: text('consent_version'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const paymentInstruments = pgTable('payment_instruments', {
  tokenRef: text('token_ref').primaryKey(),
  providerId: text('provider_id').notNull(),
  type: text('type').notNull(), // virtual_card | bank_account | wallet
  maskedDisplay: text('masked_display').notNull(),
  state: text('state').notNull().default('active'),
  holderId: text('holder_id').notNull().references(() => users.id),
});

/** Provider-sourced account snapshot. Balances are reported by the provider, never held by FacePay. */
export const providerAccounts = pgTable('provider_accounts', {
  holderId: text('holder_id').primaryKey().references(() => users.id),
  provider: text('provider').notNull(),
  availableBalanceMinor: money('available_balance_minor').notNull(),
  currency: text('currency').notNull().default('ZAR'),
  asOf: ts('as_of').notNull().defaultNow(),
});

export const biometricConsents = pgTable('biometric_consents', {
  id: text('id').primaryKey(),
  subjectId: text('subject_id').notNull().references(() => users.id),
  modality: text('modality').notNull(),
  legalBasis: text('legal_basis').notNull().default('explicit_consent'),
  purpose: text('purpose').notNull(),
  version: text('version').notNull(),
  grantedAt: ts('granted_at').notNull(),
  revokedAt: ts('revoked_at'),
});

/** Stores only opaque vendor references. Never templates, images or embeddings. */
export const verificationSessions = pgTable('verification_sessions', {
  id: text('id').primaryKey(),
  purpose: text('purpose').notNull(),
  modality: text('modality').notNull(),
  subjectId: text('subject_id').notNull(),
  requestedBy: text('requested_by').notNull(),
  tenantId: text('tenant_id').notNull(),
  paymentIntentId: text('payment_intent_id'),
  challengeRef: text('challenge_ref').notNull(),
  expiresAt: ts('expires_at').notNull(),
  result: text('result').notNull(), // verified | failed
  failureCode: text('failure_code'),
  vendorRef: text('vendor_ref'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const paymentIntents = pgTable('payment_intents', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => tenants.id),
  amountMinor: money('amount_minor').notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull(),
  idempotencyKey: text('idempotency_key'),
  payerId: text('payer_id'),
  channel: text('channel').notNull().default('face'),
  createdBy: text('created_by'),
  providerRef: text('provider_ref'),
  providerConfirmed: boolean('provider_confirmed').notNull().default(false),
  declineCode: text('decline_code'),
  expiresAt: ts('expires_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('payment_intents_merchant_idem').on(t.merchantId, t.idempotencyKey),
  index('payment_intents_merchant_idx').on(t.merchantId),
]);

export const transactions = pgTable('transactions', {
  id: text('id').primaryKey(),
  intentId: text('intent_id').notNull().references(() => paymentIntents.id),
  merchantId: text('merchant_id').notNull().references(() => tenants.id),
  merchantName: text('merchant_name').notNull(),
  customerId: text('customer_id'),
  amountMinor: money('amount_minor').notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull(),
  channel: text('channel').notNull(),
  providerRef: text('provider_ref'),
  resultCode: text('result_code'),
  settlementBatchId: text('settlement_batch_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  capturedAt: ts('captured_at'),
}, (t) => [
  index('transactions_merchant_idx').on(t.merchantId, t.createdAt),
  index('transactions_customer_idx').on(t.customerId, t.createdAt),
]);

export const refunds = pgTable('refunds', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id').notNull().references(() => transactions.id),
  merchantId: text('merchant_id').notNull(),
  amountMinor: money('amount_minor').notNull(),
  currency: text('currency').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull(),
  makerId: text('maker_id').notNull(),
  checkerId: text('checker_id'),
  decisionNote: text('decision_note'),
  providerRef: text('provider_ref'),
  evidenceRef: text('evidence_ref'),
  createdAt: ts('created_at').notNull().defaultNow(),
  decidedAt: ts('decided_at'),
});

export const settlementBatches = pgTable('settlement_batches', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => tenants.id),
  provider: text('provider').notNull(),
  periodStart: ts('period_start').notNull(),
  periodEnd: ts('period_end').notNull(),
  grossMinor: money('gross_minor').notNull(),
  feeMinor: money('fee_minor').notNull(),
  netMinor: money('net_minor').notNull(),
  currency: text('currency').notNull().default('ZAR'),
  status: text('status').notNull().default('open'), // open | closed | paid
  reconciliationStatus: text('reconciliation_status').notNull().default('pending'),
  payoutDate: ts('payout_date'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const settlementLines = pgTable('settlement_lines', {
  id: text('id').primaryKey(),
  batchId: text('batch_id').notNull().references(() => settlementBatches.id),
  providerRef: text('provider_ref').notNull(),
  amountMinor: money('amount_minor').notNull(),
  currency: text('currency').notNull(),
});

export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => tenants.id),
  model: text('model').notNull(),
  serial: text('serial').notNull().unique(),
  certificateRef: text('certificate_ref').notNull(),
  firmware: text('firmware').notNull(),
  health: text('health').notNull().default('healthy'), // healthy | degraded | offline
  connection: text('connection').notNull().default('online'),
  lastSeenAt: ts('last_seen_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Append-only, hash-chained. Rows are never updated or deleted by application code. */
export const auditEvents = pgTable('audit_events', {
  seq: serial('seq').primaryKey(),
  id: text('id').notNull().unique(),
  actorId: text('actor_id').notNull(),
  actorRole: text('actor_role').notNull(),
  action: text('action').notNull(),
  tenantId: text('tenant_id'),
  objectRef: text('object_ref').notNull(),
  beforeHash: text('before_hash'),
  afterHash: text('after_hash'),
  createdAt: ts('created_at').notNull(),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
});

export const idempotencyKeys = pgTable('idempotency_keys', {
  scope: text('scope').notNull(), // principal + method + path
  key: text('key').notNull(),
  requestHash: text('request_hash').notNull(),
  state: text('state').notNull(), // in_progress | done
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.scope, t.key] })]);

export const approvals = pgTable('approvals', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  subject: text('subject').notNull(),
  justification: text('justification').notNull(),
  requestedBy: text('requested_by').notNull(),
  status: text('status').notNull().default('pending'), // pending | approved | denied | expired
  decidedBy: text('decided_by'),
  expiresAt: ts('expires_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  decidedAt: ts('decided_at'),
});

export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  url: text('url').notNull(),
  events: jsonb('events').notNull().$type<string[]>(),
  secretHash: text('secret_hash').notNull(),
  secretPrefix: text('secret_prefix').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  visibility: text('visibility').notNull().default('catalog'), // catalog | private
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  environment: text('environment').notNull().default('sandbox'),
  status: text('status').notNull().default('healthy'),
  errorRatePct: integer('error_rate_bp').notNull().default(0), // basis points
  keyRotatedAt: ts('key_rotated_at'),
  lastEventAt: ts('last_event_at'),
});

/** Versioned metric snapshots behind dashboards (event source + refresh timestamp). */
export const metrics = pgTable('metrics', {
  key: text('key').notNull(),
  scope: text('scope').notNull(), // 'platform' or tenant id
  value: jsonb('value').notNull(),
  source: text('source').notNull(),
  version: text('version').notNull(),
  refreshedAt: ts('refreshed_at').notNull(),
}, (t) => [primaryKey({ columns: [t.key, t.scope] })]);

export const leads = pgTable('leads', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  company: text('company'),
  email: text('email').notNull(),
  message: text('message'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

