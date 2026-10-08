import { and, desc, eq, lt, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { approvals, auditEvents, integrations, webhookSubscriptions } from '../../db/schema.js';
import { sha256, verifyChain } from '../../domain/audit.js';
import { DomainError, ROLES, ROLE_MATRIX, PERMISSIONS, type Principal } from '../../domain/rbac.js';
import { appendAudit, loadChain } from '../../services/audit.js';
import { publicAudit } from '../../services/serialize.js';
import { withIdempotency } from '../idempotency.js';
import { jsonBody, pageParams, parse, requirePerm, type Env } from '../http.js';

export const adminRoutes = new Hono<Env>();

adminRoutes.get('/v1/roles', async (c) => {
  requirePerm(c, 'roles:read');
  return c.json({
    items: ROLES.map((r) => ({ role: r, label: ROLE_MATRIX[r].label, description: ROLE_MATRIX[r].description, restrictions: ROLE_MATRIX[r].restrictions, dataScope: ROLE_MATRIX[r].scope, permissions: ROLE_MATRIX[r].permissions })),
    permissions: PERMISSIONS,
  });
});

const publicApproval = (a: typeof approvals.$inferSelect) => ({
  id: a.id, kind: a.kind, subject: a.subject, justification: a.justification, requestedBy: a.requestedBy, status: a.status, decidedBy: a.decidedBy,
  expiresAt: a.expiresAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString(), decidedAt: a.decidedAt?.toISOString() ?? null,
});

adminRoutes.get('/v1/approvals', async (c) => {
  requirePerm(c, 'approvals:read');
  const { db } = c.get('app');
  const rows = await db.select().from(approvals).orderBy(desc(approvals.createdAt));
  const now = Date.now();
  return c.json({ items: rows.map((a) => publicApproval(a.status === 'pending' && a.expiresAt && a.expiresAt.getTime() < now ? { ...a, status: 'expired' } : a)) });
});

async function decide(c: any, p: Principal, decision: 'approved' | 'denied') {
  const { db } = c.get('app');
  const id = c.req.param('id');
  const [a] = await db.select().from(approvals).where(eq(approvals.id, id));
  if (!a) throw new DomainError(404, 'not_found', 'Approval not found');
  if (a.status !== 'pending') throw new DomainError(409, 'invalid_state_transition', `Approval is already ${a.status}`);
  if (a.expiresAt && a.expiresAt.getTime() < Date.now()) throw new DomainError(409, 'approval_expired', 'Approval request has expired');
  if (a.requestedBy === p.id) throw new DomainError(403, 'maker_checker_violation', 'Dual approval: the approver must differ from the requester');
  const [row] = await db.update(approvals).set({ status: decision, decidedBy: p.id, decidedAt: new Date() }).where(and(eq(approvals.id, id), eq(approvals.status, 'pending'))).returning();
  if (!row) throw new DomainError(409, 'invalid_state_transition', 'Approval already decided');
  await appendAudit(db, { actorId: p.id, actorRole: p.role, action: `approval.${decision === 'approved' ? 'approve' : 'deny'}`, tenantId: p.tenantId, objectRef: id, before: { status: 'pending' }, after: { status: decision } });
  return c.json(publicApproval(row));
}
adminRoutes.post('/v1/approvals/:id/approve', async (c) => decide(c, requirePerm(c, 'approvals:decide'), 'approved'));
adminRoutes.post('/v1/approvals/:id/deny', async (c) => decide(c, requirePerm(c, 'approvals:decide'), 'denied'));

adminRoutes.get('/v1/audit-events', async (c) => {
  requirePerm(c, 'audit:read');
  const { db } = c.get('app');
  const { limit, cursor } = pageParams(c);
  const before = cursor ? parseInt(cursor, 10) : null;
  const rows = await db.select().from(auditEvents).where(before ? lt(auditEvents.seq, before) : undefined).orderBy(desc(auditEvents.seq)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const chain = await loadChain(db);
  const v = verifyChain(chain);
  return c.json({
    items: page.map(publicAudit),
    nextCursor: rows.length > limit ? String(page[page.length - 1]!.seq) : null,
    chain: { ok: v.ok, length: chain.length, headHash: chain[chain.length - 1]?.hash ?? null },
  });
});

adminRoutes.get('/v1/integrations', async (c) => {
  const p = requirePerm(c, 'integrations:read');
  const { db } = c.get('app');
  const platform = ROLE_MATRIX[p.role].scope === 'platform';
  const rows = await db.select().from(integrations).where(platform ? undefined : or(eq(integrations.visibility, 'catalog'), eq(integrations.tenantId, p.tenantId))).orderBy(integrations.name);
  return c.json({
    items: rows.map((i) => ({
      id: i.id, name: i.name, kind: i.kind, environment: i.environment, status: i.status, errorRatePct: i.errorRatePct / 100,
      keyRotatedAt: i.keyRotatedAt?.toISOString() ?? null, lastEventAt: i.lastEventAt?.toISOString() ?? null,
    })),
  });
});

const Webhook = z.object({
  url: z.string().url().max(500).refine((u) => u.startsWith('https://') || /^http:\/\/localhost(:\d+)?\//.test(u), 'url must be https'),
  events: z.array(z.string().min(1).max(64)).min(1).max(20),
});

adminRoutes.post('/v1/webhooks/subscriptions', async (c) => {
  const p = requirePerm(c, 'webhooks:write');
  const body = parse(Webhook, await jsonBody(c));
  const { db } = c.get('app');
  return withIdempotency(c, body, { required: false }, async () => {
    const secret = 'whsec_' + randomBytes(24).toString('hex');
    const id = `wh_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    await db.insert(webhookSubscriptions).values({ id, tenantId: p.tenantId, url: body.url, events: body.events, secretHash: sha256(secret), secretPrefix: secret.slice(0, 10), createdBy: p.id });
    await appendAudit(db, { actorId: p.id, actorRole: p.role, action: 'webhook.subscribe', tenantId: p.tenantId, objectRef: id, after: { url: body.url, events: body.events } });
    // The secret is shown exactly once; only its hash is stored.
    return { status: 201, body: { id, url: body.url, events: body.events, secret, secretPrefix: secret.slice(0, 10), createdAt: new Date().toISOString() } };
  });
});
