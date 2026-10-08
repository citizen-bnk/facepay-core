import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, isPaid } from '../src/domain/payment-intent';
import { assertChecker, requiresChecker } from '../src/domain/refund';
import { assertBiometricAllowed } from '../src/domain/consent';
import { reconcile } from '../src/domain/reconciliation';
import { PERMISSIONS, ROLES, ROLE_MATRIX, can, canAccessRow } from '../src/domain/rbac';
import { GENESIS, computeHash, verifyChain, type ChainRow } from '../src/domain/audit';

describe('payment intent state machine', () => {
  it('allows the happy path and blocks shortcuts', () => {
    expect(canTransition('created', 'requires_verification')).toBe(true);
    expect(canTransition('requires_verification', 'processing')).toBe(true);
    expect(canTransition('processing', 'authorised')).toBe(true);
    expect(canTransition('authorised', 'captured')).toBe(true);
    expect(canTransition('created', 'captured')).toBe(false);
    expect(canTransition('processing', 'captured')).toBe(false);
    expect(() => assertTransition('declined', 'captured')).toThrow();
  });
  it('is only paid when captured and provider confirmed', () => {
    expect(isPaid('captured', false)).toBe(false);
    expect(isPaid('authorised', true)).toBe(false);
    expect(isPaid('captured', true)).toBe(true);
  });
});

describe('refund maker/checker', () => {
  it('threshold requires a checker and checker must differ', () => {
    expect(requiresChecker(499_999, 500_000)).toBe(false);
    expect(requiresChecker(500_000, 500_000)).toBe(true);
    expect(() => assertChecker('a', 'a')).toThrow(/different/);
    expect(() => assertChecker('a', 'b')).not.toThrow();
  });
});

describe('consent', () => {
  const now = new Date();
  const c = (revoked: boolean) => [{ subjectId: 's', modality: 'face', purpose: 'payments', grantedAt: new Date(now.getTime() - 1000), revokedAt: revoked ? new Date(now.getTime() - 500) : null }];
  it('blocks biometrics after revocation but never PIN', () => {
    expect(() => assertBiometricAllowed(c(false), 's', 'face', now)).not.toThrow();
    expect(() => assertBiometricAllowed(c(true), 's', 'face', now)).toThrow(/consent/);
    expect(() => assertBiometricAllowed([], 's', 'palm', now)).toThrow();
    expect(() => assertBiometricAllowed([], 's', 'pin', now)).not.toThrow();
  });
});

describe('reconciliation', () => {
  const ledger = [
    { providerRef: 'a', amountMinor: 100, currency: 'ZAR' },
    { providerRef: 'b', amountMinor: 200, currency: 'ZAR' },
    { providerRef: 'c', amountMinor: 300, currency: 'ZAR' },
    { providerRef: 'd', amountMinor: 400, currency: 'ZAR' },
  ];
  it('is clean when everything matches', () => {
    expect(reconcile(ledger, ledger).status).toBe('reconciled');
  });
  it('finds duplicates, gaps, currency/amount mismatches, unmatched and stale batches', () => {
    const lines = [
      { providerRef: 'a', amountMinor: 100, currency: 'ZAR' },
      { providerRef: 'a', amountMinor: 100, currency: 'ZAR' }, // duplicate
      { providerRef: 'b', amountMinor: 200, currency: 'USD' }, // currency mismatch
      { providerRef: 'c', amountMinor: 350, currency: 'ZAR' }, // amount mismatch
      { providerRef: 'zzz', amountMinor: 5, currency: 'ZAR' }, // unmatched
    ]; // d missing => gap
    const r = reconcile(ledger, lines, { batchCreatedAt: new Date(Date.now() - 100 * 3600_000), batchClosed: false });
    const kinds = r.exceptions.map((e) => e.kind).sort();
    expect(kinds).toEqual(['amount_mismatch', 'currency_mismatch', 'duplicate', 'gap', 'stale_batch', 'unmatched']);
    expect(r.status).toBe('exceptions');
  });
});

describe('rbac', () => {
  it('defines every role with a restrictive matrix', () => {
    expect(ROLES.length).toBe(10);
    for (const r of ROLES) expect(ROLE_MATRIX[r].permissions.length).toBeGreaterThan(0);
  });
  it('no role can read raw biometrics; auditor cannot mutate; cashier cannot approve refunds', () => {
    for (const r of ROLES) expect(can(r, 'biometrics:read_raw')).toBe(false);
    const mutating = PERMISSIONS.filter((p) => /create|confirm|revoke|approve|decide|enrol|write/.test(p));
    for (const p of mutating) expect(can('auditor', p)).toBe(false);
    expect(can('merchant_cashier', 'refunds:approve')).toBe(false);
    expect(can('support_agent', 'verification:create')).toBe(false);
  });
  it('enforces tenant isolation', () => {
    const owner = { id: 'u', role: 'merchant_owner' as const, tenantId: 't1', scopes: [] };
    expect(canAccessRow(owner, { tenantId: 't1' })).toBe(true);
    expect(canAccessRow(owner, { tenantId: 't2' })).toBe(false);
    const cust = { id: 'c1', role: 'customer' as const, tenantId: 'x', scopes: [] };
    expect(canAccessRow(cust, { ownerUserId: 'c2', tenantId: 'x' })).toBe(false);
  });
});

describe('audit chain', () => {
  it('detects tampering', () => {
    const mk = (seq: number, prev: string): ChainRow => {
      const base = { seq, actorId: 'u', actorRole: 'r', action: 'x', tenantId: null, objectRef: 'o', beforeHash: null, afterHash: null, createdAt: new Date(1_700_000_000_000 + seq), prevHash: prev };
      return { ...base, hash: computeHash(base) };
    };
    const a = mk(1, GENESIS), b = mk(2, a.hash), c = mk(3, b.hash);
    expect(verifyChain([a, b, c]).ok).toBe(true);
    expect(verifyChain([a, { ...b, action: 'tampered' }, c]).ok).toBe(false);
    expect(verifyChain([a, c]).ok).toBe(false);
  });
});
