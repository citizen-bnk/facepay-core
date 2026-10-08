import { Hono } from 'hono';
import { z } from 'zod';
import { confirmIntent, createIntent, createVerificationSession, getIntent, transactionIdFor, MAX_AMOUNT_MINOR } from '../../services/payments.js';
import { publicIntent } from '../../services/serialize.js';
import { withIdempotency } from '../idempotency.js';
import { jsonBody, parse, requirePerm, type Env } from '../http.js';

export const paymentRoutes = new Hono<Env>();

const CreateIntent = z.object({
  merchantId: z.string().min(1).max(64),
  amountMinor: z.number().int().positive().max(MAX_AMOUNT_MINOR),
  currency: z.string().length(3),
  expiresAt: z.string().datetime().optional(),
  channel: z.enum(['face', 'nfc', 'qr', 'card', 'palm', 'fingerprint']).optional(),
});

paymentRoutes.post('/v1/payment-intents', async (c) => {
  const p = requirePerm(c, 'payment_intents:create');
  const raw = await jsonBody(c);
  const body = parse(CreateIntent, raw);
  return withIdempotency(c, body, { required: true }, async () => {
    const r = await createIntent(c.get('app'), p, { ...body, expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined, idempotencyKey: c.req.header('Idempotency-Key') });
    return { status: 201, body: publicIntent(r.intent, r.transactionId) };
  });
});

paymentRoutes.get('/v1/payment-intents/:id', async (c) => {
  const p = requirePerm(c, 'payment_intents:read');
  const app = c.get('app');
  const i = await getIntent(app, p, c.req.param('id'));
  return c.json(publicIntent(i, await transactionIdFor(app, i.id)));
});

const Confirm = z.object({ verificationSessionId: z.string().min(1).max(64).optional() }).default({});

paymentRoutes.post('/v1/payment-intents/:id/confirm', async (c) => {
  const p = requirePerm(c, 'payment_intents:confirm');
  const body = parse(Confirm, await c.req.json().catch(() => ({})));
  const id = c.req.param('id');
  return withIdempotency(c, { id, ...body }, { required: false }, async () => {
    const r = await confirmIntent(c.get('app'), p, id, body);
    return { status: 200, body: publicIntent(r.intent, r.transactionId) };
  });
});

const Verify = z.object({
  purpose: z.enum(['checkout', 'enrolment', 'step_up']),
  paymentIntentId: z.string().max(64).optional(),
  modality: z.enum(['face', 'fingerprint', 'palm', 'retina', 'pin']).optional(),
  subjectId: z.string().max(64).optional(),
  simulate: z.enum(['liveness_failed', 'no_match']).optional(),
});

paymentRoutes.post('/v1/verification-sessions', async (c) => {
  const p = requirePerm(c, 'verification:create');
  const body = parse(Verify, await jsonBody(c));
  const s = await createVerificationSession(c.get('app'), p, body);
  return c.json(s, 201);
});
