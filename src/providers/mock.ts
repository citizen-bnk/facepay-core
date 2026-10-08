import { createHash } from 'node:crypto';
import type { AccountStore, BiometricProvider, ChallengeRequest, ChallengeResult, PaymentProvider, Providers } from './types.js';

const h = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Mock payment provider (sandbox). Magic amounts, in minor units:
 *   amount % 1000 === 999 -> declined (do_not_honour)
 *   amount % 1000 === 998 -> provider timeout: authorisation stays pending, nothing is captured
 *   amount % 1000 === 997 -> authorised, but capture confirmation stays pending
 * Anything above the holder's available balance is declined (insufficient_funds).
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'Mock Bank Provider (sandbox)';
  constructor(private store: AccountStore) {}

  async authorise(req: Parameters<PaymentProvider['authorise']>[0]) {
    const providerRef = 'prov_' + h(req.idempotencyKey).slice(0, 20);
    const m = req.amountMinor % 1000;
    if (m === 998) return { status: 'pending' as const, providerRef };
    if (m === 999) return { status: 'declined' as const, providerRef, declineCode: 'do_not_honour' };
    if ((await this.store.balance(req.holderId)) < req.amountMinor) {
      return { status: 'declined' as const, providerRef, declineCode: 'insufficient_funds' };
    }
    return { status: 'authorised' as const, providerRef };
  }

  async capture(req: Parameters<PaymentProvider['capture']>[0]) {
    if (req.amountMinor % 1000 === 997) return { status: 'pending' as const, providerRef: req.providerRef };
    await this.store.adjust(req.holderId, -req.amountMinor);
    return { status: 'captured' as const, providerRef: req.providerRef, confirmedAt: new Date() };
  }

  async refund(req: Parameters<PaymentProvider['refund']>[0]) {
    await this.store.adjust(req.holderId, req.amountMinor);
    return { status: 'processed' as const, providerRefundRef: 'prov_rf_' + h(req.idempotencyKey).slice(0, 20) };
  }
}

/** Mock biometric vendor. Returns opaque refs only; there is no template anywhere in this process. */
export class MockBiometricProvider implements BiometricProvider {
  readonly name = 'Mock Biometric Vendor (sandbox)';

  async runChallenge(req: ChallengeRequest): Promise<ChallengeResult> {
    const nonce = h(`${req.subjectId}:${req.modality}:${Date.now()}:${Math.random()}`).slice(0, 16);
    const challengeRef = `chl_${nonce}`;
    const vendorRef = `vnd_${h(req.subjectId + req.modality).slice(0, 24)}`;
    const result = req.simulate === 'liveness_failed' ? 'liveness_failed' : req.simulate === 'no_match' ? 'no_match' : 'matched';
    return { result, vendorRef, challengeRef };
  }

  async deleteSubject(): Promise<void> {
    /* vendor-side deletion would be requested here */
  }
}

export function createMockProviders(store: AccountStore): Providers {
  return { payments: new MockPaymentProvider(store), biometrics: new MockBiometricProvider() };
}
