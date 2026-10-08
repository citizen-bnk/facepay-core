import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context.js';
import { biometricConsents, paymentInstruments, paymentIntents, providerAccounts, tenants, transactions, users, verificationSessions } from '../db/schema.js';
import { assertBiometricAllowed, isBiometric } from '../domain/consent.js';
import { assertTransition, isExpired, toTxnStatus, type IntentStatus } from '../domain/payment-intent.js';
import { DomainError, canAccessRow, type Principal } from '../domain/rbac.js';
import { appendAudit } from './audit.js';
import type { BiometricModality } from '../providers/types.js';

const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
export const MAX_AMOUNT_MINOR = 100_000_000;

type Intent = typeof paymentIntents.$inferSelect;

async function loadIntentFor(app: AppContext, p: Principal, id: string): Promise<Intent> {
  const [i] = await app.db.select().from(paymentIntents).where(eq(paymentIntents.id, id));
  // Customers may see intents they paid; tenant roles their own tenant's; platform roles everything.
  if (!i || !canAccessRow(p, { tenantId: i.merchantId, ownerUserId: i.payerId })) throw new DomainError(404, 'not_found', 'Payment intent not found');
  return i;
}
export const getIntent = loadIntentFor;

export async function transactionIdFor(app: AppContext, intentId: string): Promise<string | undefined> {
  const [t] = await app.db.select({ id: transactions.id }).from(transactions).where(eq(transactions.intentId, intentId));
  return t?.id;
}

export async function createIntent(
  app: AppContext,
  p: Principal,
  input: { merchantId: string; amountMinor: number; currency: string; expiresAt?: Date; channel?: string; idempotencyKey?: string },
) {
  if (input.currency !== 'ZAR') throw new DomainError(422, 'unsupported_currency', 'Only ZAR is supported');
  if (input.merchantId !== p.tenantId) throw new DomainError(403, 'cross_tenant_denied', 'Cannot create payment intents for another merchant');
  const [m] = await app.db.select().from(tenants).where(and(eq(tenants.id, input.merchantId), eq(tenants.type, 'merchant')));
  if (!m) throw new DomainError(404, 'merchant_not_found', 'Merchant not found');
  const now = new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + 15 * 60_000);
  if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() > now.getTime() + 24 * 3600_000) {
    throw new DomainError(422, 'invalid_expiry', 'expiresAt must be in the future and within 24 hours');
  }
  const id = newId('pi');
  const txnId = newId('txn');
  const channel = input.channel ?? 'face';
  await app.db.transaction(async (tx) => {
    await tx.insert(paymentIntents).values({ id, merchantId: m.id, amountMinor: input.amountMinor, currency: 'ZAR', status: 'created', idempotencyKey: input.idempotencyKey ?? null, channel, createdBy: p.id, expiresAt });
    await tx.insert(transactions).values({ id: txnId, intentId: id, merchantId: m.id, merchantName: m.name, amountMinor: input.amountMinor, currency: 'ZAR', status: 'pending', channel });
  });
  await appendAudit(app.db, { actorId: p.id, actorRole: p.role, action: 'payment_intent.create', tenantId: m.id, objectRef: id, after: { amountMinor: input.amountMinor, currency: 'ZAR', status: 'created' } });
  const [row] = await app.db.select().from(paymentIntents).where(eq(paymentIntents.id, id));
  return { intent: row!, transactionId: txnId };
}

/** Compare-and-set transition: only succeeds if the intent is still in one of `from`. */
async function move(app: AppContext, id: string, from: IntentStatus[], to: IntentStatus, patch: Partial<Intent> = {}): Promise<Intent | null> {
  for (const f of from) assertTransition(f, to);
  const [row] = await app.db
    .update(paymentIntents)
    .set({ ...patch, status: to, updatedAt: new Date() })
    .where(and(eq(paymentIntents.id, id), inArray(paymentIntents.status, from)))
    .returning();
  if (row) {
    const txnPatch: Partial<typeof transactions.$inferInsert> = { status: toTxnStatus(to), channel: row.channel };
    if (to === 'captured') txnPatch.capturedAt = new Date();
    if (patch.providerRef) txnPatch.providerRef = patch.providerRef;
    if (to === 'captured') txnPatch.resultCode = '00';
    if (to === 'declined') txnPatch.resultCode = '51';
    if (row.payerId) txnPatch.customerId = row.payerId;
    await app.db.update(transactions).set(txnPatch).where(eq(transactions.intentId, id));
  }
  return row ?? null;
}

const channelFor = (modality: string) => (modality === 'face' || modality === 'retina' ? 'face' : modality === 'palm' ? 'palm' : modality === 'fingerprint' ? 'fingerprint' : 'card');

export async function createVerificationSession(
  app: AppContext,
  p: Principal,
  input: { purpose: string; paymentIntentId?: string; modality?: string; subjectId?: string; simulate?: 'liveness_failed' | 'no_match' },
) {
  const modality = input.modality ?? 'face';
  let intent: Intent | undefined;
  if (input.paymentIntentId) {
    intent = await loadIntentFor(app, p, input.paymentIntentId);
    if (isExpired(intent.expiresAt)) throw new DomainError(409, 'intent_expired', 'Payment intent has expired');
    if (['captured', 'declined', 'failed', 'expired', 'cancelled', 'refunded'].includes(intent.status)) throw new DomainError(409, 'invalid_state_transition', `Intent is ${intent.status}`);
  }
  // The subject: customers verify themselves; POS staff name the payer the vendor matched.
  const subjectId = p.role === 'customer' ? p.id : input.subjectId;
  if (!subjectId) throw new DomainError(422, 'validation_error', 'subjectId is required for merchant-initiated verification');
  if (p.role === 'customer' && input.subjectId && input.subjectId !== p.id) throw new DomainError(403, 'forbidden', 'Customers can only verify themselves');
  const [subject] = await app.db.select().from(users).where(and(eq(users.id, subjectId), eq(users.role, 'customer')));
  if (!subject) throw new DomainError(404, 'subject_not_found', 'Customer not found');

  // Consent gate: revoked/missing consent blocks biometric challenges. PIN is the non-biometric path.
  if (isBiometric(modality)) {
    const consents = await app.db.select().from(biometricConsents).where(eq(biometricConsents.subjectId, subjectId));
    assertBiometricAllowed(consents, subjectId, modality);
  }

  let result: 'verified' | 'failed' = 'verified';
  let failureCode: string | null = null;
  let vendorRef: string | null = null;
  let challengeRef = newId('chl');
  if (isBiometric(modality)) {
    const r = await app.providers.biometrics.runChallenge({ subjectId, modality: modality as BiometricModality, purpose: input.purpose, simulate: process.env.NODE_ENV === 'production' ? undefined : input.simulate });
    vendorRef = r.vendorRef; // opaque ref only
    challengeRef = r.challengeRef;
    if (r.result !== 'matched') { result = 'failed'; failureCode = r.result; }
  }
  const id = newId('vs');
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  await app.db.insert(verificationSessions).values({
    id, purpose: input.purpose, modality, subjectId, requestedBy: p.id, tenantId: p.tenantId, paymentIntentId: intent?.id ?? null, challengeRef, expiresAt, result, failureCode, vendorRef,
  });
  if (intent && intent.status === 'created') await move(app, intent.id, ['created'], 'requires_verification');
  await appendAudit(app.db, { actorId: p.id, actorRole: p.role, action: 'verification_session.create', tenantId: p.tenantId, objectRef: id, after: { purpose: input.purpose, modality, result } });
  return { id, purpose: input.purpose, modality, status: result, failureCode, challengeRef, expiresAt: expiresAt.toISOString(), paymentIntentId: intent?.id ?? null };
}

export async function confirmIntent(app: AppContext, p: Principal, intentId: string, input: { verificationSessionId?: string }) {
  let intent = await loadIntentFor(app, p, intentId);
  // Duplicate-safe: confirming something already settled returns the current state with no new effect.
  if (['captured', 'authorised', 'declined', 'failed', 'cancelled', 'refunded', 'expired'].includes(intent.status)) {
    return { intent, transactionId: await transactionIdFor(app, intentId), replay: true };
  }
  if (isExpired(intent.expiresAt)) {
    await move(app, intent.id, ['created', 'requires_verification'], 'expired');
    throw new DomainError(409, 'intent_expired', 'Payment intent has expired');
  }
  if (!input.verificationSessionId) throw new DomainError(422, 'verification_required', 'A verified verification session is required (step-up)');
  const [vs] = await app.db.select().from(verificationSessions).where(eq(verificationSessions.id, input.verificationSessionId));
  if (!vs || (vs.tenantId !== p.tenantId && p.role !== 'customer') || (p.role === 'customer' && vs.subjectId !== p.id)) throw new DomainError(404, 'not_found', 'Verification session not found');
  if (vs.paymentIntentId && vs.paymentIntentId !== intent.id) throw new DomainError(409, 'verification_mismatch', 'Verification session is bound to a different payment intent');
  if (vs.result !== 'verified') throw new DomainError(422, 'verification_failed', 'Verification did not succeed');
  if (vs.expiresAt.getTime() <= Date.now()) throw new DomainError(422, 'verification_expired', 'Verification session expired');
  if (isBiometric(vs.modality)) {
    // Consent may have been revoked since the challenge ran.
    const consents = await app.db.select().from(biometricConsents).where(eq(biometricConsents.subjectId, vs.subjectId));
    assertBiometricAllowed(consents, vs.subjectId, vs.modality);
  }

  const channel = channelFor(vs.modality);
  if (intent.status === 'created') await move(app, intent.id, ['created'], 'requires_verification');
  // Claim the intent. A concurrent confirm loses the race and gets the current state back.
  const claimed = await move(app, intent.id, ['requires_verification', 'processing'], 'processing', { payerId: vs.subjectId, channel });
  if (!claimed) return { intent: await loadIntentFor(app, p, intentId), transactionId: await transactionIdFor(app, intentId), replay: true };
  intent = claimed;

  const current = async () => ({ intent: await loadIntentFor(app, p, intentId), transactionId: await transactionIdFor(app, intentId), replay: true });
  const [inst] = await app.db.select().from(paymentInstruments).where(and(eq(paymentInstruments.holderId, vs.subjectId), eq(paymentInstruments.state, 'active')));
  if (!inst) {
    const d = await move(app, intent.id, ['processing'], 'declined', { declineCode: 'no_funding_instrument' });
    return d ? { intent: d, transactionId: await transactionIdFor(app, intentId) } : current();
  }
  const idem = `intent:${intent.id}`;
  const auth = await app.providers.payments.authorise({ intentId: intent.id, idempotencyKey: idem, instrumentRef: inst.tokenRef, holderId: vs.subjectId, merchantId: intent.merchantId, amountMinor: intent.amountMinor, currency: intent.currency });
  if (auth.status === 'declined') {
    const d = await move(app, intent.id, ['processing'], 'declined', { declineCode: auth.declineCode ?? 'declined', providerRef: auth.providerRef });
    if (!d) return current();
    intent = d;
  } else if (auth.status === 'pending') {
    // Provider timeout: remain `processing`. Never shown as paid until the provider confirms.
    const [row] = await app.db.update(paymentIntents).set({ providerRef: auth.providerRef, updatedAt: new Date() }).where(and(eq(paymentIntents.id, intent.id), eq(paymentIntents.status, 'processing'))).returning();
    if (!row) return current();
    intent = row;
  } else {
    // Only the caller that wins this compare-and-set may capture, so a capture is never duplicated.
    const authed = await move(app, intent.id, ['processing'], 'authorised', { providerRef: auth.providerRef });
    if (!authed) return current();
    intent = authed;
    const cap = await app.providers.payments.capture({ providerRef: auth.providerRef, idempotencyKey: idem, holderId: vs.subjectId, amountMinor: intent.amountMinor, currency: intent.currency });
    if (cap.status === 'captured') {
      intent = (await move(app, intent.id, ['authorised'], 'captured', { providerConfirmed: true })) ?? intent;
    } else if (cap.status === 'failed') {
      intent = (await move(app, intent.id, ['authorised'], 'failed', { declineCode: 'capture_failed' })) ?? intent;
    } // pending: stays `authorised`, not captured
  }
  await appendAudit(app.db, { actorId: p.id, actorRole: p.role, action: 'payment_intent.confirm', tenantId: intent.merchantId, objectRef: intent.id, after: { status: intent.status, providerConfirmed: intent.providerConfirmed } });
  return { intent, transactionId: await transactionIdFor(app, intentId) };
}

export async function walletFor(app: AppContext, userId: string) {
  const [acct] = await app.db.select().from(providerAccounts).where(eq(providerAccounts.holderId, userId));
  const methods = await app.db.select().from(paymentInstruments).where(eq(paymentInstruments.holderId, userId));
  return { acct, methods };
}
