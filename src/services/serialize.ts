import { isPaid, toTxnStatus, type IntentStatus } from '../domain/payment-intent.js';
import type { auditEvents, paymentIntents, transactions } from '../db/schema.js';

type Txn = typeof transactions.$inferSelect;
type Intent = typeof paymentIntents.$inferSelect;

export const publicTxn = (t: Txn) => ({
  id: t.id,
  intentId: t.intentId,
  merchantId: t.merchantId,
  merchantName: t.merchantName,
  amountMinor: t.amountMinor,
  currency: t.currency,
  status: t.status as 'pending' | 'authorised' | 'captured' | 'declined' | 'refunded',
  channel: t.channel as 'face' | 'nfc' | 'qr' | 'card' | 'palm' | 'fingerprint',
  createdAt: t.createdAt.toISOString(),
});

export const publicIntent = (i: Intent, transactionId?: string) => ({
  id: i.id,
  merchantId: i.merchantId,
  amountMinor: i.amountMinor,
  currency: i.currency,
  status: i.status as IntentStatus,
  transactionStatus: toTxnStatus(i.status as IntentStatus),
  channel: i.channel,
  /** true only when the provider has confirmed the capture */
  paid: isPaid(i.status as IntentStatus, i.providerConfirmed),
  providerConfirmed: i.providerConfirmed,
  declineCode: i.declineCode,
  transactionId: transactionId ?? null,
  expiresAt: i.expiresAt?.toISOString() ?? null,
  createdAt: i.createdAt.toISOString(),
  updatedAt: i.updatedAt.toISOString(),
});

export const publicAudit = (a: typeof auditEvents.$inferSelect) => ({
  id: a.id, seq: a.seq, actorId: a.actorId, actorRole: a.actorRole, action: a.action, tenantId: a.tenantId, objectRef: a.objectRef,
  beforeHash: a.beforeHash, afterHash: a.afterHash, prevHash: a.prevHash, hash: a.hash, createdAt: a.createdAt.toISOString(),
});

export const maskName = (n: string) => n.split(' ').map((p) => (p.length <= 1 ? p : p[0] + '*'.repeat(Math.min(p.length - 1, 4)))).join(' ');
export const maskEmail = (e: string) => {
  const [l, d] = e.split('@');
  return `${l![0]}***@${d}`;
};
