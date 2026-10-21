import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { leads } from '../../db/schema.js';
import { jsonBody, parse, type Env } from '../http.js';
import { rateLimit } from '../ratelimit.js';
import { buildOpenApi } from '../openapi.js';
import { docsHtml, docsAsset } from '../docs-content.js';

export const publicRoutes = new Hono<Env>();

publicRoutes.get('/', (c) => {
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  c.header('Cache-Control', 'no-cache');
  return c.html(docsHtml());
});
publicRoutes.get('/docs', (c) => c.redirect('/'));
publicRoutes.get('/docs/logo.svg', (c) => c.body(docsAsset('logo.svg'), 200, { 'Content-Type': 'image/svg+xml' }));
for (const weight of [400, 600]) publicRoutes.get('/docs/poppins-' + weight + '.woff2', (c) => c.body(new Uint8Array(readFileSync(join(process.cwd(), 'src/api/docs-assets', 'poppins-' + weight + '.woff2'))), 200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=86400' }));
publicRoutes.get('/docs/styles.css', (c) => c.body(docsAsset('styles.css'), 200, { 'Content-Type': 'text/css; charset=utf-8' }));
publicRoutes.get('/docs/app.js', (c) => c.body(docsAsset('app.js'), 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));
publicRoutes.get('/docs/runner.js', (c) => c.body(docsAsset('runner.js'), 200, {
  'Content-Type': 'text/javascript; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; connect-src 'none'; script-src 'unsafe-eval'",
  'Cache-Control': 'no-store',
}));
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
