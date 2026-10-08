import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { leads } from '../../db/schema.js';
import { jsonBody, parse, type Env } from '../http.js';
import { rateLimit } from '../ratelimit.js';
import { buildOpenApi } from '../openapi.js';
import { docsHtml } from '../docs.js';

export const publicRoutes = new Hono<Env>();

publicRoutes.get('/', (c) => c.html(docsHtml()));
publicRoutes.get('/v1/openapi.json', (c) => c.json(buildOpenApi()));
publicRoutes.get('/v1/health', (c) => c.json({ status: 'ok', service: 'facepay-core', time: new Date().toISOString() }));

const Lead = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().max(160).optional().default(''),
  email: z.string().trim().email().max(254),
  message: z.string().trim().max(2000).optional().default(''),
  kind: z.enum(['demo', 'hardware', 'partner']),
});

publicRoutes.post('/v1/leads', async (c) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  rateLimit(`lead:${ip}`, 5, 60_000);
  const body = parse(Lead, await jsonBody(c));
  const id = `lead_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
  await c.get('app').db.insert(leads).values({ id, ...body });
  return c.json({ id, status: 'received' }, 201);
});
