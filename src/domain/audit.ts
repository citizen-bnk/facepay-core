import { createHash } from 'node:crypto';

export interface AuditInput {
  actorId: string;
  actorRole: string;
  action: string;
  tenantId: string | null;
  objectRef: string;
  before?: unknown;
  after?: unknown;
}

export const GENESIS = '0'.repeat(64);

export function stableStringify(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hashObject = (v: unknown) => sha256(stableStringify(v));

export interface ChainRow {
  seq: number;
  actorId: string;
  actorRole: string;
  action: string;
  tenantId: string | null;
  objectRef: string;
  beforeHash: string | null;
  afterHash: string | null;
  createdAt: Date;
  prevHash: string;
  hash: string;
}

export function computeHash(r: Omit<ChainRow, 'hash'>): string {
  return sha256(
    stableStringify([r.seq, r.actorId, r.actorRole, r.action, r.tenantId, r.objectRef, r.beforeHash, r.afterHash, r.createdAt.toISOString(), r.prevHash]),
  );
}

export function verifyChain(rows: ChainRow[]): { ok: boolean; brokenAt?: number } {
  let prev = GENESIS;
  for (const r of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (r.prevHash !== prev || computeHash(r) !== r.hash) return { ok: false, brokenAt: r.seq };
    prev = r.hash;
  }
  return { ok: true };
}
