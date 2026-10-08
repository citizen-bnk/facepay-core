import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { HTTPException } from 'hono/http-exception';
import { getContext, type AppContext } from '../context.js';
import { DomainError } from '../domain/rbac.js';
import { verifyToken } from '../auth.js';
import type { Env } from './http.js';
import { authRoutes } from './routes/auth.js';
import { moneyRoutes } from './routes/money.js';
import { paymentRoutes } from './routes/payments.js';
import { refundRoutes } from './routes/refunds.js';
import { opsRoutes } from './routes/ops.js';
import { dashboardRoutes } from './routes/dashboards.js';
import { adminRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';

const PUBLIC_PATHS = new Set(['/v1/auth/login', '/v1/leads', '/v1/openapi.json', '/v1/health']);

export function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function originAllowed(origin: string): boolean {
  const list = allowedOrigins();
  if (list.includes('*')) return true;
  if (list.includes(origin)) return true;
  // Local development convenience only when no allow-list is configured and not in production.
  if (list.length === 0 && process.env.NODE_ENV !== 'production') return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return false;
}

export function createApp(ctx?: AppContext | (() => Promise<AppContext>)) {
  const app = new Hono<Env>();
  const resolve = async () => (typeof ctx === 'function' ? ctx() : ctx ?? getContext());

  app.use('*', secureHeaders());
  app.use(
    '*',
    cors({
      origin: (origin) => (origin && originAllowed(origin) ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      exposeHeaders: ['Idempotent-Replayed'],
      maxAge: 600,
    }),
  );
  app.use('/v1/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.method === 'OPTIONS') return next();
    c.set('app', await resolve());
    if (PUBLIC_PATHS.has(c.req.path)) return next();
    const h = c.req.header('Authorization');
    if (!h?.startsWith('Bearer ')) throw new DomainError(401, 'unauthenticated', 'Missing bearer token');
    c.set('principal', await verifyToken(h.slice(7)));
    return next();
  });

  app.route('/', publicRoutes);
  app.route('/', authRoutes);
  app.route('/', moneyRoutes);
  app.route('/', paymentRoutes);
  app.route('/', refundRoutes);
  app.route('/', opsRoutes);
  app.route('/', dashboardRoutes);
  app.route('/', adminRoutes);

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));
  app.onError((err, c) => {
    if (err instanceof DomainError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    if (err instanceof HTTPException) return c.json({ error: { code: 'http_error', message: err.message } }, err.status);
    console.error('unhandled', err instanceof Error ? err.message : err);
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });
  return app;
}
