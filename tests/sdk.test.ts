import { beforeAll, describe, expect, it } from 'vitest';
import { FacePayClient, FacePayError } from '../packages/sdk/src/index';
import { boot, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => { h = await boot(); });
const client = () => new FacePayClient({ baseUrl: 'http://x', fetch: ((u: string, init: any) => h.app.request(u.replace('http://x', ''), init)) as any });

describe('@facepay/sdk', () => {
  it('logs in and reads the wallet', async () => {
    const c = client();
    const r = await c.login('thabo@facepay.demo', 'facepay-demo');
    expect(r.user.role).toBe('customer');
    expect((await c.wallet()).availableBalanceMinor).toBe(1_245_000);
    expect((await c.listTransactions({ limit: 2 })).items).toHaveLength(2);
  });
  it('runs a full checkout and surfaces typed errors', async () => {
    const c = client();
    await c.login('cashier@abcstore.demo', 'facepay-demo');
    const pi = await c.createPaymentIntent({ merchantId: 'tenant_abc', amountMinor: 15_000, currency: 'ZAR' });
    const vs = await c.createVerificationSession({ purpose: 'checkout', paymentIntentId: pi.id, subjectId: 'usr_thabo' });
    const done = await c.confirmPaymentIntent(pi.id, { verificationSessionId: vs.id });
    expect(done.paid).toBe(true);
    await expect(c.listSettlements()).rejects.toBeInstanceOf(FacePayError);
    await expect(c.listSettlements()).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });
  it('submits leads without a token', async () => {
    expect((await client().submitLead({ name: 'A', email: 'a@example.com', kind: 'partner' })).status).toBe('received');
  });
});
