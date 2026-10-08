/** Provider adapter interfaces. Real processors / biometric vendors implement these. */

export interface AuthoriseRequest {
  intentId: string;
  idempotencyKey: string;
  instrumentRef: string; // token ref, never a PAN
  holderId: string;
  merchantId: string;
  amountMinor: number;
  currency: string;
}
export interface AuthoriseResult {
  status: 'authorised' | 'declined' | 'pending';
  providerRef: string;
  declineCode?: string;
}
export interface CaptureResult {
  /** `captured` is only returned once the provider has CONFIRMED the capture. */
  status: 'captured' | 'pending' | 'failed';
  providerRef: string;
  confirmedAt?: Date;
}
export interface RefundResult {
  status: 'processed' | 'pending' | 'failed';
  providerRefundRef: string;
}

export interface PaymentProvider {
  readonly name: string;
  authorise(req: AuthoriseRequest): Promise<AuthoriseResult>;
  capture(req: { providerRef: string; idempotencyKey: string; holderId: string; amountMinor: number; currency: string }): Promise<CaptureResult>;
  refund(req: { providerRef: string; idempotencyKey: string; holderId: string; amountMinor: number; currency: string }): Promise<RefundResult>;
}

export type BiometricModality = 'face' | 'fingerprint' | 'palm' | 'retina';

export interface ChallengeRequest {
  subjectId: string;
  modality: BiometricModality;
  purpose: string;
  /** Test hook honoured by the mock only. */
  simulate?: 'liveness_failed' | 'no_match';
}
export interface ChallengeResult {
  result: 'matched' | 'liveness_failed' | 'no_match';
  /** Opaque vendor reference. The ONLY biometric-related datum FacePay stores. */
  vendorRef: string;
  challengeRef: string;
}

export interface BiometricProvider {
  readonly name: string;
  runChallenge(req: ChallengeRequest): Promise<ChallengeResult>;
  /** Ask the vendor to delete everything it holds for this subject (consent revocation / DSAR). */
  deleteSubject(subjectId: string): Promise<void>;
}

export interface Providers {
  payments: PaymentProvider;
  biometrics: BiometricProvider;
}

/** Mock provider's view of the provider-held ledger (backed by provider_accounts). */
export interface AccountStore {
  balance(holderId: string): Promise<number>;
  adjust(holderId: string, deltaMinor: number): Promise<void>;
}
