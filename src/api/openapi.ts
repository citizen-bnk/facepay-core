import { PERMISSIONS } from '../domain/rbac.js';

type Op = { m: 'get' | 'post'; path: string; summary: string; perm?: string; body?: string; res?: string; idem?: 'required' | 'optional'; public?: boolean; query?: string[] };

const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const str = { type: 'string' };
const int = { type: 'integer', description: 'Minor units (ZAR cents)' };

export const OPERATIONS: Op[] = [
  { m: 'post', path: '/v1/auth/login', summary: 'Log in and receive a signed JWT', body: 'LoginRequest', res: 'LoginResponse', public: true },
  { m: 'get', path: '/v1/me', summary: 'Current user and scopes', res: 'Me' },
  { m: 'get', path: '/v1/wallet', summary: 'Provider-sourced wallet', perm: 'wallet:read', res: 'Wallet' },
  { m: 'get', path: '/v1/transactions', summary: 'Search paginated transactions', perm: 'transactions:read', res: 'TransactionPage', query: ['limit', 'cursor', 'status', 'q'] },
  { m: 'get', path: '/v1/transactions/{id}', summary: 'Transaction detail', perm: 'transactions:read', res: 'Transaction' },
  { m: 'post', path: '/v1/payment-intents', summary: 'Create a payment intent', perm: 'payment_intents:create', body: 'CreatePaymentIntent', res: 'PaymentIntent', idem: 'required' },
  { m: 'get', path: '/v1/payment-intents/{id}', summary: 'Fetch authorisation and settlement status', perm: 'payment_intents:read', res: 'PaymentIntent' },
  { m: 'post', path: '/v1/payment-intents/{id}/confirm', summary: 'Confirm with a verified step-up session. Captured only after provider confirmation.', perm: 'payment_intents:confirm', body: 'ConfirmPaymentIntent', res: 'PaymentIntent', idem: 'optional' },
  { m: 'post', path: '/v1/verification-sessions', summary: 'Create a consent-linked verification challenge', perm: 'verification:create', body: 'CreateVerificationSession', res: 'VerificationSession' },
  { m: 'post', path: '/v1/refunds', summary: 'Request a refund (maker). Over-threshold refunds need a distinct checker.', perm: 'refunds:create', body: 'CreateRefund', res: 'Refund', idem: 'optional' },
  { m: 'get', path: '/v1/refunds', summary: 'List refunds', perm: 'refunds:read', res: 'RefundList' },
  { m: 'post', path: '/v1/refunds/{id}/approve', summary: 'Approve a pending refund (checker != maker)', perm: 'refunds:approve', res: 'Refund' },
  { m: 'post', path: '/v1/refunds/{id}/reject', summary: 'Reject a pending refund (checker != maker)', perm: 'refunds:approve', res: 'Refund' },
  { m: 'get', path: '/v1/settlements', summary: 'Settlement batches with live reconciliation (?format=csv)', perm: 'settlements:read', res: 'SettlementList' },
  { m: 'get', path: '/v1/devices', summary: 'Device fleet', perm: 'devices:read', res: 'DeviceList' },
  { m: 'post', path: '/v1/devices/enrol', summary: 'Enrol a terminal', perm: 'devices:enrol', body: 'EnrolDevice', res: 'Device', idem: 'optional' },
  { m: 'get', path: '/v1/merchants', summary: 'List merchants', perm: 'merchants:read', res: 'Generic' },
  { m: 'get', path: '/v1/merchants/{id}', summary: 'Merchant detail', perm: 'merchants:read', res: 'Generic' },
  { m: 'get', path: '/v1/customers', summary: 'Customers (masked)', perm: 'customers:read', res: 'Generic' },
  { m: 'get', path: '/v1/customers/{id}/biometric-media', summary: 'Always 403: raw biometrics are never exposed', res: 'Error' },
  { m: 'get', path: '/v1/consents', summary: 'Biometric consents', perm: 'consents:read', res: 'Generic' },
  { m: 'post', path: '/v1/consents/{id}/revoke', summary: 'Revoke a biometric consent', perm: 'consents:revoke', res: 'Generic' },
  { m: 'get', path: '/v1/admin/overview', summary: 'Platform KPIs and series', perm: 'admin:overview', res: 'Generic' },
  { m: 'get', path: '/v1/merchant/dashboard', summary: 'Merchant dashboard', perm: 'merchant:dashboard', res: 'Generic' },
  { m: 'get', path: '/v1/roles', summary: 'Role and permission matrix', perm: 'roles:read', res: 'Generic' },
  { m: 'get', path: '/v1/approvals', summary: 'Privileged-change approvals', perm: 'approvals:read', res: 'Generic' },
  { m: 'post', path: '/v1/approvals/{id}/approve', summary: 'Approve (requester != approver)', perm: 'approvals:decide', res: 'Generic' },
  { m: 'post', path: '/v1/approvals/{id}/deny', summary: 'Deny', perm: 'approvals:decide', res: 'Generic' },
  { m: 'get', path: '/v1/audit-events', summary: 'Hash-chained audit log', perm: 'audit:read', res: 'Generic', query: ['limit', 'cursor'] },
  { m: 'get', path: '/v1/integrations', summary: 'Integrations and webhook health', perm: 'integrations:read', res: 'Generic' },
  { m: 'post', path: '/v1/webhooks/subscriptions', summary: 'Register a webhook destination (secret shown once)', perm: 'webhooks:write', body: 'WebhookSubscription', res: 'Generic', idem: 'optional' },
  { m: 'post', path: '/v1/leads', summary: 'Website lead form', body: 'Lead', res: 'Generic', public: true },
  { m: 'get', path: '/v1/health', summary: 'Liveness', public: true, res: 'Generic' },
  { m: 'get', path: '/v1/openapi.json', summary: 'This document', public: true, res: 'Generic' },
];

const schemas: Record<string, unknown> = {
  Error: obj({ error: obj({ code: str, message: str }, ['code', 'message']) }, ['error']),
  Generic: { type: 'object', additionalProperties: true },
  LoginRequest: obj({ email: { type: 'string', format: 'email' }, password: str }, ['email', 'password']),
  User: obj({ id: str, name: str, email: str, role: { type: 'string', enum: ['customer', 'merchant_owner', 'merchant_cashier', 'support_agent', 'kyc_risk_analyst', 'finance_operator', 'device_technician', 'integration_operator', 'super_user', 'auditor'] }, tenantId: str }),
  LoginResponse: obj({ token: str, expiresIn: { type: 'integer' }, user: ref('User') }, ['token', 'user']),
  Me: obj({ id: str, name: str, email: str, role: str, tenantId: str, tenantName: str, scopes: { type: 'array', items: str } }),
  Transaction: obj({
    id: str, intentId: str, merchantId: str, merchantName: str, amountMinor: int, currency: str,
    status: { type: 'string', enum: ['pending', 'authorised', 'captured', 'declined', 'refunded'] },
    channel: { type: 'string', enum: ['face', 'nfc', 'qr', 'card', 'palm', 'fingerprint'] }, createdAt: { type: 'string', format: 'date-time' },
  }, ['id', 'intentId', 'merchantId', 'merchantName', 'amountMinor', 'currency', 'status', 'channel', 'createdAt']),
  TransactionPage: obj({ items: { type: 'array', items: ref('Transaction') }, nextCursor: { type: ['string', 'null'] } }),
  Wallet: obj({
    provider: str, balanceSource: { type: 'string', enum: ['provider'] }, availableBalanceMinor: int, currency: str,
    methods: { type: 'array', items: obj({ id: str, type: str, maskedDisplay: str, state: str }) }, recent: { type: 'array', items: ref('Transaction') },
  }),
  CreatePaymentIntent: obj({ merchantId: str, amountMinor: int, currency: { type: 'string', example: 'ZAR' }, expiresAt: { type: 'string', format: 'date-time' }, channel: str }, ['merchantId', 'amountMinor', 'currency']),
  ConfirmPaymentIntent: obj({ verificationSessionId: str }),
  PaymentIntent: obj({
    id: str, merchantId: str, amountMinor: int, currency: str,
    status: { type: 'string', enum: ['created', 'requires_verification', 'processing', 'authorised', 'captured', 'declined', 'failed', 'expired', 'cancelled', 'refunded'] },
    paid: { type: 'boolean', description: 'True only when the provider has confirmed capture' }, providerConfirmed: { type: 'boolean' }, transactionId: { type: ['string', 'null'] },
    expiresAt: { type: ['string', 'null'] }, createdAt: str,
  }),
  CreateVerificationSession: obj({ purpose: { type: 'string', enum: ['checkout', 'enrolment', 'step_up'] }, paymentIntentId: str, modality: { type: 'string', enum: ['face', 'fingerprint', 'palm', 'retina', 'pin'] }, subjectId: str }, ['purpose']),
  VerificationSession: obj({ id: str, purpose: str, modality: str, status: { type: 'string', enum: ['verified', 'failed'] }, challengeRef: str, expiresAt: str, paymentIntentId: { type: ['string', 'null'] } }),
  CreateRefund: obj({ transactionId: str, amountMinor: int, reason: str }, ['transactionId', 'amountMinor', 'reason']),
  Refund: obj({ id: str, transactionId: str, amountMinor: int, currency: str, reason: str, status: { type: 'string', enum: ['pending_approval', 'approved', 'processing', 'processed', 'rejected', 'failed'] }, makerId: str, checkerId: { type: ['string', 'null'] } }),
  RefundList: obj({ items: { type: 'array', items: ref('Refund') }, thresholdMinor: int }),
  SettlementList: obj({ items: { type: 'array', items: obj({ id: str, merchantId: str, grossMinor: int, feeMinor: int, netMinor: int, status: str, reconciliationStatus: { type: 'string', enum: ['reconciled', 'exceptions'] }, reconciliation: { type: 'object', additionalProperties: true } }) } }),
  Device: obj({ id: str, merchantId: str, model: str, serial: str, firmware: str, health: str, connection: str }),
  DeviceList: obj({ items: { type: 'array', items: ref('Device') } }),
  EnrolDevice: obj({ merchantId: str, model: str, serial: str, certificateRef: str, firmware: str }, ['model', 'serial']),
  WebhookSubscription: obj({ url: { type: 'string', format: 'uri' }, events: { type: 'array', items: str } }, ['url', 'events']),
  Lead: obj({ name: str, company: str, email: str, message: str, kind: { type: 'string', enum: ['demo', 'hardware', 'partner'] } }, ['name', 'email', 'kind']),
};

export function buildOpenApi() {
  const paths: Record<string, any> = {};
  for (const o of OPERATIONS) {
    const params: any[] = [...(o.path.match(/\{(\w+)\}/g) ?? []).map((p) => ({ name: p.slice(1, -1), in: 'path', required: true, schema: str })), ...(o.query ?? []).map((q) => ({ name: q, in: 'query', schema: str }))];
    if (o.idem) params.push({ name: 'Idempotency-Key', in: 'header', required: o.idem === 'required', schema: str });
    (paths[o.path] ??= {})[o.m] = {
      summary: o.summary,
      ...(o.perm ? { description: `Requires permission \`${o.perm}\`.` } : {}),
      security: o.public ? [] : [{ bearerAuth: [] }],
      parameters: params,
      ...(o.body ? { requestBody: { required: true, content: { 'application/json': { schema: ref(o.body) } } } } : {}),
      responses: {
        [o.m === 'post' && o.res !== 'LoginResponse' ? '200/201' : '200']: { description: 'OK', content: { 'application/json': { schema: ref(o.res ?? 'Generic') } } },
        default: { description: 'Error {error:{code,message}}', content: { 'application/json': { schema: ref('Error') } } },
      },
    };
  }
  // OpenAPI response keys must be single codes
  for (const p of Object.values(paths)) for (const op of Object.values<any>(p)) if (op.responses['200/201']) { op.responses['201'] = op.responses['200/201']; delete op.responses['200/201']; }
  return {
    openapi: '3.1.0',
    info: { title: 'FacePay Core API', version: '0.1.0', description: 'FACE YOUR MONEY. Amounts are integers in minor units (ZAR cents). Balances are provider-sourced. A payment is never captured until the provider confirms.' },
    servers: [{ url: 'https://api.facepay.com' }, { url: 'http://localhost:8787' }],
    paths,
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }, schemas },
    'x-permissions': PERMISSIONS,
  };
}
