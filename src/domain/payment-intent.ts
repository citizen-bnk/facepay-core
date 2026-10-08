import { DomainError } from './rbac.js';

/**
 * Payment intent state machine.
 * An intent is only `captured` after the provider has confirmed the capture.
 */
export const INTENT_STATUSES = [
  'created',
  'requires_verification',
  'processing',
  'authorised',
  'captured',
  'declined',
  'failed',
  'expired',
  'cancelled',
  'refunded',
] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

const TRANSITIONS: Record<IntentStatus, readonly IntentStatus[]> = {
  created: ['requires_verification', 'expired', 'cancelled'],
  requires_verification: ['processing', 'declined', 'expired', 'cancelled'],
  processing: ['authorised', 'declined', 'failed', 'processing'],
  authorised: ['captured', 'cancelled', 'failed'],
  captured: ['refunded'],
  declined: [],
  failed: [],
  expired: [],
  cancelled: [],
  refunded: [],
};

export const TERMINAL: readonly IntentStatus[] = ['declined', 'failed', 'expired', 'cancelled', 'refunded'];

export function canTransition(from: IntentStatus, to: IntentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: IntentStatus, to: IntentStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError(409, 'invalid_state_transition', `Payment intent cannot move from ${from} to ${to}`);
  }
}

export function isExpired(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return !!expiresAt && expiresAt.getTime() <= now.getTime();
}

/** Status a UI may label "paid": only a provider-confirmed capture. */
export function isPaid(status: IntentStatus, providerConfirmed: boolean): boolean {
  return status === 'captured' && providerConfirmed;
}

/** Intent status -> public Transaction status. */
export type TxnStatus = 'pending' | 'authorised' | 'captured' | 'declined' | 'refunded';
export function toTxnStatus(s: IntentStatus): TxnStatus {
  switch (s) {
    case 'captured': return 'captured';
    case 'authorised': return 'authorised';
    case 'declined': case 'failed': case 'expired': case 'cancelled': return 'declined';
    case 'refunded': return 'refunded';
    default: return 'pending';
  }
}
