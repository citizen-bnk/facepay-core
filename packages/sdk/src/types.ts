/** Shared FacePay API types. Amounts are integers in minor units (ZAR cents). */

export type Role =
  | 'customer' | 'merchant_owner' | 'merchant_cashier' | 'support_agent' | 'kyc_risk_analyst'
  | 'finance_operator' | 'device_technician' | 'integration_operator' | 'super_user' | 'auditor';

export type Currency = 'ZAR';
export type TransactionStatus = 'pending' | 'authorised' | 'captured' | 'declined' | 'refunded';
export type Channel = 'face' | 'nfc' | 'qr' | 'card' | 'palm' | 'fingerprint';

export interface ApiErrorBody { error: { code: string; message: string } }

export interface User { id: string; name: string; email: string; role: Role; tenantId: string }
export interface LoginRequest { email: string; password: string }
export interface LoginResponse { token: string; expiresIn?: number; user: User }
export interface Me extends User { tenantName: string; scopes: string[]; verificationState?: string }

export interface Transaction {
  id: string;
  intentId: string;
  merchantId: string;
  merchantName: string;
  amountMinor: number;
  currency: string;
  status: TransactionStatus;
  channel: Channel;
  createdAt: string;
}
export interface TransactionDetail extends Transaction {
  providerConfirmed: boolean;
  resultCode: string | null;
  providerRef?: string;
  settlementBatchId: string | null;
  reconciliationState: string;
  capturedAt: string | null;
  refunds: Refund[];
}
export interface TransactionPage { items: Transaction[]; nextCursor: string | null }
export interface TransactionQuery { limit?: number; cursor?: string; status?: TransactionStatus; q?: string }

export interface PaymentMethod { id: string; type: string; maskedDisplay: string; state: string }
export interface Wallet {
  provider: string;
  balanceSource?: 'provider';
  balanceAsOf?: string;
  availableBalanceMinor: number;
  currency: string;
  methods: PaymentMethod[];
  recent: Transaction[];
}

export type PaymentIntentStatus =
  | 'created' | 'requires_verification' | 'processing' | 'authorised' | 'captured'
  | 'declined' | 'failed' | 'expired' | 'cancelled' | 'refunded';
export interface CreatePaymentIntent { merchantId: string; amountMinor: number; currency: Currency | string; expiresAt?: string; channel?: Channel }
export interface PaymentIntent {
  id: string;
  merchantId: string;
  amountMinor: number;
  currency: string;
  status: PaymentIntentStatus;
  transactionStatus: TransactionStatus;
  channel: string;
  /** True only when the provider has confirmed the capture. Never show "paid" otherwise. */
  paid: boolean;
  providerConfirmed: boolean;
  declineCode: string | null;
  transactionId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ConfirmPaymentIntent { verificationSessionId?: string }

export type VerificationPurpose = 'checkout' | 'enrolment' | 'step_up';
export type Modality = 'face' | 'fingerprint' | 'palm' | 'retina' | 'pin';
export interface CreateVerificationSession { purpose: VerificationPurpose; paymentIntentId?: string; modality?: Modality; subjectId?: string }
export interface VerificationSession {
  id: string; purpose: string; modality: string; status: 'verified' | 'failed'; failureCode: string | null;
  challengeRef: string; expiresAt: string; paymentIntentId: string | null;
}

export type RefundStatus = 'pending_approval' | 'approved' | 'processing' | 'processed' | 'rejected' | 'failed';
export interface CreateRefund { transactionId: string; amountMinor: number; reason: string }
export interface Refund {
  id: string; transactionId: string; merchantId: string; amountMinor: number; currency: string; reason: string; status: RefundStatus;
  makerId: string; checkerId: string | null; requiresApproval: boolean; decisionNote: string | null; createdAt: string; decidedAt: string | null;
}
export interface RefundList { items: Refund[]; thresholdMinor: number }

export type ReconciliationException =
  | { kind: 'duplicate'; providerRef: string; count: number }
  | { kind: 'gap'; providerRef: string; detail: string }
  | { kind: 'unmatched'; providerRef: string; detail: string }
  | { kind: 'currency_mismatch'; providerRef: string; expected: string; actual: string }
  | { kind: 'amount_mismatch'; providerRef: string; expectedMinor: number; actualMinor: number }
  | { kind: 'stale_batch'; detail: string };
export interface SettlementBatch {
  id: string; merchantId: string; merchantName: string; provider: string; periodStart: string; periodEnd: string;
  grossMinor: number; feeMinor: number; netMinor: number; currency: string; status: 'open' | 'closed' | 'paid';
  reconciliationStatus: 'reconciled' | 'exceptions'; payoutDate: string | null;
  reconciliation: { matched: number; exceptions: ReconciliationException[] };
}

export interface Device {
  id: string; merchantId: string; model: string; serial: string; firmware: string; health: 'healthy' | 'degraded' | 'offline' | string;
  connection: string; certificateRef: string; lastSeenAt: string | null;
}
export interface EnrolDevice { merchantId?: string; model: string; serial: string; certificateRef?: string; firmware?: string }

export interface Merchant {
  id: string; name: string; legalEntityRef: string | null; onboardingState: string; category: string | null; city: string | null;
  settlementProviderRef: string | null; policyId: string | null; deviceCount: number;
}
export interface Customer {
  id: string; name: string; email: string; contact: string | null; verificationState: string;
  biometricConsent: 'active' | 'revoked' | 'none'; createdAt: string;
}
export interface Consent {
  id: string; subjectId: string; subjectName?: string; modality: string; purpose: string; legalBasis: string; version: string;
  grantedAt: string; revokedAt: string | null; status: 'active' | 'revoked';
}

export interface Delta { [k: string]: number }
export interface AdminOverview {
  kpis: {
    totalTransactions: number; totalUsers: number; volumeMinor: number; currency: string; averageTransactionMinor: number;
    activeMerchants: number; activeDevices: number; uptimePct: number; successRatePct: number; deltas: Delta;
  };
  byChannel: { channel: string; pct: number }[];
  trends: { date: string; volumeMinor: number; count: number }[];
  incidents: { id: string; severity: string; title: string; openedAt: string }[];
  asOf: string | null;
  meta: { source: string | null; version: string | null; refreshedAt: string | null; note: string };
}
export interface MerchantDashboard {
  kpis: { totalSalesMinor: number; totalCustomers: number; averageTransactionMinor: number; activeDevices: number; currency: string; deltas: Delta };
  salesTrend: { date: string; amountMinor: number }[];
  paymentTypes: { type: string; pct: number }[];
  refunds: { total: number; totalMinor: number; pendingApproval: number; processed: number; currency: string };
  settlement: { status: string; latestBatchId: string | null; pendingNetMinor: number; nextPayoutDate: string | null; currency: string };
  fleet: { total: number; online: number; degraded: number; offline: number };
  meta: { source: string; version: string; refreshedAt: string };
}

export interface RoleDefinition { role: Role; label: string; description: string; restrictions: string; dataScope: 'own' | 'tenant' | 'platform'; permissions: string[] }
export interface Approval {
  id: string; kind: string; subject: string; justification: string; requestedBy: string; status: 'pending' | 'approved' | 'denied' | 'expired';
  decidedBy: string | null; expiresAt: string | null; createdAt: string; decidedAt: string | null;
}
export interface AuditEvent {
  id: string; seq: number; actorId: string; actorRole: string; action: string; tenantId: string | null; objectRef: string;
  beforeHash: string | null; afterHash: string | null; prevHash: string; hash: string; createdAt: string;
}
export interface AuditPage { items: AuditEvent[]; nextCursor: string | null; chain: { ok: boolean; length: number; headHash: string | null } }
export interface Integration {
  id: string; name: string; kind: string; environment: string; status: string; errorRatePct: number; keyRotatedAt: string | null; lastEventAt: string | null;
}
export interface WebhookSubscriptionInput { url: string; events: string[] }
export interface WebhookSubscription { id: string; url: string; events: string[]; secret: string; secretPrefix: string; createdAt: string }

export type LeadKind = 'demo' | 'hardware' | 'partner';
export interface Lead { name: string; company?: string; email: string; message?: string; kind: LeadKind }
export interface LeadReceipt { id: string; status: 'received' }
