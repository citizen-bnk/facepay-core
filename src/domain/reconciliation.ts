/** Settlement reconciliation: intents <-> provider settlement lines. */
export interface LedgerEntry {
  providerRef: string;
  amountMinor: number;
  currency: string;
}
export interface SettlementLine {
  providerRef: string;
  amountMinor: number;
  currency: string;
}
export type Exception =
  | { kind: 'duplicate'; providerRef: string; count: number }
  | { kind: 'gap'; providerRef: string; detail: string } // in ledger but missing from settlement file
  | { kind: 'unmatched'; providerRef: string; detail: string } // in settlement file but not in ledger
  | { kind: 'currency_mismatch'; providerRef: string; expected: string; actual: string }
  | { kind: 'amount_mismatch'; providerRef: string; expectedMinor: number; actualMinor: number }
  | { kind: 'stale_batch'; detail: string };

export interface ReconcileResult {
  status: 'reconciled' | 'exceptions';
  matched: number;
  exceptions: Exception[];
}

export const STALE_BATCH_HOURS = 72;

export function reconcile(
  ledger: LedgerEntry[],
  lines: SettlementLine[],
  opts: { batchCreatedAt?: Date; batchClosed?: boolean; now?: Date } = {},
): ReconcileResult {
  const exceptions: Exception[] = [];
  const counts = new Map<string, SettlementLine[]>();
  for (const l of lines) counts.set(l.providerRef, [...(counts.get(l.providerRef) ?? []), l]);
  const byRef = new Map(ledger.map((e) => [e.providerRef, e]));
  let matched = 0;

  for (const [ref, ls] of counts) {
    if (ls.length > 1) exceptions.push({ kind: 'duplicate', providerRef: ref, count: ls.length });
    const entry = byRef.get(ref);
    if (!entry) {
      exceptions.push({ kind: 'unmatched', providerRef: ref, detail: 'Settlement line has no ledger entry' });
      continue;
    }
    const l = ls[0]!;
    if (l.currency !== entry.currency) {
      exceptions.push({ kind: 'currency_mismatch', providerRef: ref, expected: entry.currency, actual: l.currency });
    } else if (l.amountMinor !== entry.amountMinor) {
      exceptions.push({ kind: 'amount_mismatch', providerRef: ref, expectedMinor: entry.amountMinor, actualMinor: l.amountMinor });
    } else if (ls.length === 1) {
      matched++;
    }
  }
  for (const e of ledger) {
    if (!counts.has(e.providerRef)) exceptions.push({ kind: 'gap', providerRef: e.providerRef, detail: 'Ledger entry missing from settlement file' });
  }
  if (opts.batchCreatedAt && !opts.batchClosed) {
    const now = opts.now ?? new Date();
    if (now.getTime() - opts.batchCreatedAt.getTime() > STALE_BATCH_HOURS * 3600_000) {
      exceptions.push({ kind: 'stale_batch', detail: `Batch open for more than ${STALE_BATCH_HOURS}h` });
    }
  }
  return { status: exceptions.length ? 'exceptions' : 'reconciled', matched, exceptions };
}
