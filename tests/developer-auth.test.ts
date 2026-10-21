import { describe,it,expect } from 'vitest';
import { developerPrincipal, type DeveloperRecord } from '../src/developer-auth';
const now=Date.UTC(2026,9,19);
const record: DeveloperRecord={id:'key_1',user_id:'clerk_user',tenant_id:'devtenant_1',customer_id:'devcustomer_1',scopes:['payment_intents:create','roles:read','biometrics:read_raw','unknown'],revoked_at:null,expires_at:new Date(now+86400000).toISOString(),email_verified:true,subscription_status:'active',subscription_expires_at:new Date(now+86400000).toISOString()};
describe('developer API key policy',()=>{
  it('grants only permitted scopes inside the assigned merchant',()=>{const p=developerPrincipal(record,now);expect(p.tenantId).toBe('devtenant_1');expect(p.role).toBe('merchant_owner');expect(p.scopes).toEqual(['payment_intents:create']);});
  it('rejects missing, revoked, expired or malformed expiry keys',()=>{for(const value of [undefined,{...record,revoked_at:new Date(now).toISOString()},{...record,expires_at:new Date(now-1).toISOString()},{...record,expires_at:'invalid'}])expect(()=>developerPrincipal(value,now)).toThrow(/API key/);});
  it('requires verified registration',()=>expect(()=>developerPrincipal({...record,email_verified:false},now)).toThrow(/verification/));
  it('requires a paid and unexpired subscription',()=>{for(const status of ['inactive','past_due','unpaid','canceled','trialing','incomplete'])expect(()=>developerPrincipal({...record,subscription_status:status},now)).toThrow(/subscription/);expect(()=>developerPrincipal({...record,subscription_expires_at:new Date(now-1).toISOString()},now)).toThrow(/subscription/);});
});
