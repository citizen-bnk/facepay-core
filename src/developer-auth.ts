import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import type { AppContext } from './context.js';
import { tenants, users, paymentInstruments, providerAccounts } from './db/schema.js';
import { DomainError, type Permission, type Principal } from './domain/rbac.js';

const ALLOWED: readonly Permission[] = ['payment_intents:create','payment_intents:read','payment_intents:confirm','verification:create','transactions:read','merchants:read','customers:read','devices:read','merchant:dashboard','integrations:read','webhooks:write'];
export type DeveloperRecord = {
  id: string; user_id: string; tenant_id: string; customer_id: string; scopes: string[];
  revoked_at: string | null; expires_at: string; email_verified: boolean; subscription_status: string; subscription_expires_at: string | null;
};
export function developerPrincipal(row: DeveloperRecord | undefined, now = Date.now()): Principal {
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= now || !Number.isFinite(Date.parse(row.expires_at))) throw new DomainError(401, 'invalid_api_key', 'API key is invalid, revoked or expired');
  if (!row.email_verified) throw new DomainError(403, 'email_unverified', 'Developer email verification is required');
  if (row.subscription_status !== 'active' || !row.subscription_expires_at || Date.parse(row.subscription_expires_at) <= now || !Number.isFinite(Date.parse(row.subscription_expires_at))) throw new DomainError(402, 'subscription_required', 'An active paid developer subscription is required');
  return { id: 'devactor_' + createHash('sha256').update(row.user_id).digest('hex').slice(0,20), role: 'merchant_owner', tenantId: row.tenant_id, scopes: row.scopes.filter((scope): scope is Permission => ALLOWED.includes(scope as Permission)) };
}
export async function verifyDeveloperKey(key: string, app: AppContext): Promise<{ principal: Principal; customerId: string }> {
  if (!/^fp_sandbox_[A-Za-z0-9_-]{43}$/.test(key)) throw new DomainError(401, 'invalid_api_key', 'Malformed developer API key');
  const url = process.env.DEVELOPER_DATABASE_URL;
  if (!url) throw new DomainError(503, 'developer_auth_unavailable', 'Developer key storage is not configured');
  const sql = neon(url); const hash = createHash('sha256').update(key).digest('hex');
  let row: DeveloperRecord | undefined;
  try {
    const rows = await sql`SELECT k.id,k.user_id,k.scopes,k.revoked_at,k.expires_at,a.tenant_id,a.customer_id,a.email_verified,a.subscription_status,a.subscription_expires_at FROM developer_api_keys k JOIN developer_accounts a ON a.user_id=k.user_id WHERE k.key_hash=${hash} LIMIT 1`;
    row = rows[0] as DeveloperRecord | undefined;
  } catch { throw new DomainError(503, 'developer_auth_unavailable', 'Developer key validation is temporarily unavailable'); }
  const principal = developerPrincipal(row);
  const usage = await sql`INSERT INTO developer_api_usage(key_id,window_start,requests) VALUES(${row!.id},date_trunc('minute',now()),1) ON CONFLICT(key_id,window_start) DO UPDATE SET requests=developer_api_usage.requests+1 RETURNING requests`;
  if (Number(usage[0]?.requests) > 60) throw new DomainError(429, 'rate_limited', 'Developer key limit is 60 requests per minute');
  await sql`UPDATE developer_api_keys SET last_used_at=now() WHERE id=${row!.id}`;
  // Each developer gets an isolated sandbox merchant and synthetic test customer.
  // These are simulated provider records, never real funds or biometric consent.
  await app.db.insert(tenants).values({ id: row!.tenant_id, name:'Developer sandbox',type:'merchant',category:'Developer sandbox',onboardingState:'active' }).onConflictDoNothing();
  await app.db.insert(users).values([
    { id:principal.id,tenantId:row!.tenant_id,name:'Developer API actor',email:principal.id+'@sandbox.facepay.invalid',passwordHash:'!external-auth-only',role:'merchant_owner' },
    { id:row!.customer_id,tenantId:row!.tenant_id,name:'Sandbox test customer',email:row!.customer_id+'@sandbox.facepay.invalid',passwordHash:'!external-auth-only',role:'customer' },
  ]).onConflictDoNothing();
  await app.db.insert(providerAccounts).values({ holderId:row!.customer_id,provider:'Simulated developer sandbox provider',availableBalanceMinor:10000000,currency:'ZAR' }).onConflictDoNothing();
  await app.db.insert(paymentInstruments).values({ holderId:row!.customer_id,tokenRef:'sandbox_'+row!.customer_id,providerId:'mock_payments',type:'virtual_card',maskedDisplay:'Sandbox card •••• 4242',state:'active' }).onConflictDoNothing();
  return { principal,customerId:row!.customer_id };
}
