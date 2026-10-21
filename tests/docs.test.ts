import { describe, it, expect } from 'vitest';
import { createApp } from '../src/api/app';
import { buildOpenApi, OPERATIONS } from '../src/api/openapi';

describe('interactive developer documentation', () => {
  const app = createApp();
  it('renders the contract, console, coding lab and annual programme', async () => {
    const response = await app.request('/');
    const text = await response.text();
    expect(response.status).toBe(200);
    for (const id of ['api-contract','endpoint-nav','request-form','editor','run-code','programme']) expect(text).toContain(`id="${id}"`);
    expect(text).toContain('US$100 per year');
    expect(text).toContain('Registration is automated through Clerk');
    const raw = text.match(/id="api-contract" type="application\/json">([^]*?)<\/script>/)?.[1];
    const contract = JSON.parse(raw!);
    for (const op of OPERATIONS) expect(contract.paths[op.path][op.m]).toBeTruthy();
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
  });
  it('serves worker with network-blocking CSP and no server-side code execution', async () => {
    const response = await app.request('/docs/runner.js');
    expect(response.headers.get('content-type')).toContain('javascript');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'");
    const text = await response.text();
    expect(text).toContain('pending');
    expect(text).toContain('facepay.request()');
  });
  it('serves request console assets without authentication', async () => {
    for (const path of ['/docs/app.js','/docs/styles.css']) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect((await response.text()).length).toBeGreaterThan(1000);
    }
  });
  it('documents response codes, stable operation ids and actual sandbox location', () => {
    const contract = buildOpenApi();
    expect(contract.servers[0].url).toBe('/');
    expect(contract.paths['/v1/payment-intents'].post.responses['201']).toBeTruthy();
    expect(contract.paths['/v1/payment-intents/{id}/confirm'].post.responses['200']).toBeTruthy();
    expect(contract.paths['/v1/consents/{id}/revoke'].post.responses['200']).toBeTruthy();
    const ids = OPERATIONS.map(op => contract.paths[op.path][op.m].operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const op of OPERATIONS) for (const code of Object.keys(contract.paths[op.path][op.m].responses)) expect(code === 'default' || /^\d{3}$/.test(code)).toBe(true);
  });
});
