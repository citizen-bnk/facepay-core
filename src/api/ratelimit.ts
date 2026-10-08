import { DomainError } from '../domain/rbac';

const hits = new Map<string, number[]>();

/** Best-effort in-memory limiter (per serverless instance). Put a WAF / Vercel firewall rule in front for production. */
export function rateLimit(key: string, max: number, windowMs: number): void {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return;
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new DomainError(429, 'rate_limited', 'Too many requests, slow down');
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
}
