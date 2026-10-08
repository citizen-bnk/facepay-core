import type * as T from './types.js';

export class FacePayError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'FacePayError';
  }
}

export interface FacePayClientOptions {
  baseUrl: string;
  token?: string;
  /** Custom fetch (tests, React Native polyfills, Node < 18). Defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface RequestOptions { idempotencyKey?: string; signal?: AbortSignal }

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k_${Date.now()}_${Math.random().toString(36).slice(2)}`);

export class FacePayClient {
  private baseUrl: string;
  private token?: string;
  private f: typeof fetch;

  constructor(opts: FacePayClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.f = opts.fetch ?? ((...a) => fetch(...a));
  }

  setToken(token: string | undefined) { this.token = token; }

  private async req<R>(method: 'GET' | 'POST', path: string, body?: unknown, o: RequestOptions & { query?: Record<string, string | number | undefined> } = {}): Promise<R> {
    const qs = o.query ? Object.entries(o.query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.idempotencyKey) headers['Idempotency-Key'] = o.idempotencyKey;
    const res = await this.f(`${this.baseUrl}${path}${qs ? `?${qs}` : ''}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: o.signal });
    const text = await res.text();
    let json: any;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    if (!res.ok) {
      const e = (json as T.ApiErrorBody | undefined)?.error;
      throw new FacePayError(res.status, e?.code ?? 'http_error', e?.message ?? `Request failed with ${res.status}`);
    }
    return json as R;
  }

  /** Logs in and stores the token on this client. */
  async login(email: string, password: string): Promise<T.LoginResponse> {
    const r = await this.req<T.LoginResponse>('POST', '/v1/auth/login', { email, password });
    this.token = r.token;
    return r;
  }
  me() { return this.req<T.Me>('GET', '/v1/me'); }
  wallet() { return this.req<T.Wallet>('GET', '/v1/wallet'); }

  listTransactions(q: T.TransactionQuery = {}) { return this.req<T.TransactionPage>('GET', '/v1/transactions', undefined, { query: { ...q } }); }
  getTransaction(id: string) { return this.req<T.TransactionDetail>('GET', `/v1/transactions/${encodeURIComponent(id)}`); }

  /** Idempotency-Key is required by the API; one is generated if you do not pass it. Reuse the same key to retry safely. */
  createPaymentIntent(input: T.CreatePaymentIntent, o: RequestOptions = {}) {
    return this.req<T.PaymentIntent>('POST', '/v1/payment-intents', input, { ...o, idempotencyKey: o.idempotencyKey ?? newKey() });
  }
  getPaymentIntent(id: string) { return this.req<T.PaymentIntent>('GET', `/v1/payment-intents/${encodeURIComponent(id)}`); }
  confirmPaymentIntent(id: string, input: T.ConfirmPaymentIntent = {}, o: RequestOptions = {}) {
    return this.req<T.PaymentIntent>('POST', `/v1/payment-intents/${encodeURIComponent(id)}/confirm`, input, o);
  }
  createVerificationSession(input: T.CreateVerificationSession) { return this.req<T.VerificationSession>('POST', '/v1/verification-sessions', input); }

  createRefund(input: T.CreateRefund, o: RequestOptions = {}) { return this.req<T.Refund>('POST', '/v1/refunds', input, o); }
  listRefunds() { return this.req<T.RefundList>('GET', '/v1/refunds'); }
  approveRefund(id: string, note?: string) { return this.req<T.Refund>('POST', `/v1/refunds/${encodeURIComponent(id)}/approve`, { note }); }
  rejectRefund(id: string, note?: string) { return this.req<T.Refund>('POST', `/v1/refunds/${encodeURIComponent(id)}/reject`, { note }); }

  listSettlements() { return this.req<{ items: T.SettlementBatch[] }>('GET', '/v1/settlements'); }
  listDevices() { return this.req<{ items: T.Device[] }>('GET', '/v1/devices'); }
  enrolDevice(input: T.EnrolDevice, o: RequestOptions = {}) { return this.req<T.Device>('POST', '/v1/devices/enrol', input, o); }

  listMerchants() { return this.req<{ items: T.Merchant[] }>('GET', '/v1/merchants'); }
  getMerchant(id: string) { return this.req<T.Merchant>('GET', `/v1/merchants/${encodeURIComponent(id)}`); }
  listCustomers() { return this.req<{ items: T.Customer[] }>('GET', '/v1/customers'); }

  listConsents() { return this.req<{ items: T.Consent[] }>('GET', '/v1/consents'); }
  revokeConsent(id: string) { return this.req<T.Consent>('POST', `/v1/consents/${encodeURIComponent(id)}/revoke`, {}); }

  adminOverview() { return this.req<T.AdminOverview>('GET', '/v1/admin/overview'); }
  merchantDashboard() { return this.req<T.MerchantDashboard>('GET', '/v1/merchant/dashboard'); }

  listRoles() { return this.req<{ items: T.RoleDefinition[]; permissions: string[] }>('GET', '/v1/roles'); }
  listApprovals() { return this.req<{ items: T.Approval[] }>('GET', '/v1/approvals'); }
  approve(id: string) { return this.req<T.Approval>('POST', `/v1/approvals/${encodeURIComponent(id)}/approve`, {}); }
  deny(id: string) { return this.req<T.Approval>('POST', `/v1/approvals/${encodeURIComponent(id)}/deny`, {}); }
  listAuditEvents(q: { limit?: number; cursor?: string } = {}) { return this.req<T.AuditPage>('GET', '/v1/audit-events', undefined, { query: { ...q } }); }
  listIntegrations() { return this.req<{ items: T.Integration[] }>('GET', '/v1/integrations'); }
  createWebhookSubscription(input: T.WebhookSubscriptionInput, o: RequestOptions = {}) { return this.req<T.WebhookSubscription>('POST', '/v1/webhooks/subscriptions', input, o); }

  /** Public (no token needed): website lead forms. */
  submitLead(input: T.Lead) { return this.req<T.LeadReceipt>('POST', '/v1/leads', input); }
}

export function createClient(opts: FacePayClientOptions) { return new FacePayClient(opts); }
