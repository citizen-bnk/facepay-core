import { DomainError } from './rbac.js';

export const REFUND_STATUSES = ['pending_approval', 'approved', 'processing', 'processed', 'rejected', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Refunds at or above this amount (minor units, ZAR cents) need a distinct checker. Default R 5,000.00. */
export const DEFAULT_REFUND_THRESHOLD_MINOR = 500_000;

export function refundThreshold(): number {
  const v = Number(process.env.REFUND_APPROVAL_THRESHOLD_MINOR);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_REFUND_THRESHOLD_MINOR;
}

export function requiresChecker(amountMinor: number, threshold = refundThreshold()): boolean {
  return amountMinor >= threshold;
}

export function assertRefundable(args: {
  txnStatus: string;
  txnAmountMinor: number;
  alreadyRefundedMinor: number;
  amountMinor: number;
}): void {
  if (args.txnStatus !== 'captured' && args.txnStatus !== 'refunded') {
    throw new DomainError(409, 'not_refundable', 'Only provider-confirmed captured transactions can be refunded');
  }
  if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) {
    throw new DomainError(422, 'invalid_amount', 'amountMinor must be a positive integer');
  }
  if (args.alreadyRefundedMinor + args.amountMinor > args.txnAmountMinor) {
    throw new DomainError(422, 'refund_exceeds_transaction', 'Refund exceeds the remaining refundable amount');
  }
}

/** Maker/checker: the checker must differ from the maker. */
export function assertChecker(makerId: string, checkerId: string): void {
  if (makerId === checkerId) {
    throw new DomainError(403, 'maker_checker_violation', 'Checker must be a different user than the maker');
  }
}

export function assertPending(status: string): void {
  if (status !== 'pending_approval') {
    throw new DomainError(409, 'invalid_state_transition', `Refund is ${status}, not pending approval`);
  }
}
