import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { checkPassword, signToken, TOKEN_TTL_SECONDS } from '../../auth';
import { tenants, users } from '../../db/schema';
import { DomainError, isRole } from '../../domain/rbac';
import { appendAudit } from '../../services/audit';
import { jsonBody, parse, type Env } from '../http';
import { rateLimit } from '../ratelimit';

export const authRoutes = new Hono<Env>();

const Login = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });

authRoutes.post('/v1/auth/login', async (c) => {
  const { email, password } = parse(Login, await jsonBody(c));
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  rateLimit(`login:${ip}:${email.toLowerCase()}`, 10, 60_000);
  const { db } = c.get('app');
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  const ok = await checkPassword(password, u?.passwordHash);
  if (!u || !ok || !isRole(u.role)) throw new DomainError(401, 'invalid_credentials', 'Invalid email or password');
  const token = await signToken({ id: u.id, role: u.role, tenantId: u.tenantId });
  await appendAudit(db, { actorId: u.id, actorRole: u.role, action: 'auth.login', tenantId: u.tenantId, objectRef: u.id });
  return c.json({ token, expiresIn: TOKEN_TTL_SECONDS, user: { id: u.id, name: u.name, email: u.email, role: u.role, tenantId: u.tenantId } });
});

authRoutes.get('/v1/me', async (c) => {
  const p = c.get('principal');
  const { db } = c.get('app');
  const [row] = await db.select({ u: users, tenantName: tenants.name }).from(users).innerJoin(tenants, eq(tenants.id, users.tenantId)).where(eq(users.id, p.id));
  if (!row) throw new DomainError(401, 'invalid_token', 'User no longer exists');
  const u = row.u;
  return c.json({ id: u.id, name: u.name, email: u.email, role: u.role, tenantId: u.tenantId, tenantName: row.tenantName, scopes: p.scopes, verificationState: u.verificationState });
});
