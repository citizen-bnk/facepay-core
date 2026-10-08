import { createApp } from '../src/api/app';
import { createContext, type AppContext } from '../src/context';

export const PASSWORD = 'facepay-demo';

export async function boot() {
  const ctx: AppContext = await createContext({ url: null, seedDemo: true });
  const app = createApp(ctx);
  const tokens = new Map<string, string>();

  async function call(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await app.request(path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const text = await res.text();
    let json: any = undefined;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers, text };
  }
  async function login(email: string) {
    if (!tokens.has(email)) {
      const r = await call('POST', '/v1/auth/login', { body: { email, password: PASSWORD } });
      if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
      tokens.set(email, r.json.token);
    }
    return tokens.get(email)!;
  }
  return { ctx, app, call, login };
}
export type Harness = Awaited<ReturnType<typeof boot>>;
