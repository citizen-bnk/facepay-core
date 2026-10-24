import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { DomainError } from '../src/domain/rbac.js';
const mocks=vi.hoisted(()=>({db:vi.fn(),send:vi.fn()}));
vi.mock('../src/mobile/storage.js',async original=>({...await original<typeof import('../src/mobile/storage.js')>(),mobileDb:()=>mocks.db,mobileRate:async()=>{}}));
vi.mock('../src/mobile/twilio.js',async original=>({...await original<typeof import('../src/mobile/twilio.js')>(),twilio:mocks.send}));
import { mobileRoutes } from '../src/mobile/routes.js';
import { seal, unseal } from '../src/mobile/storage.js';
import { VerifyDeliveryError } from '../src/mobile/twilio.js';
const app=new Hono().route('/',mobileRoutes);
app.onError((error,c)=>error instanceof DomainError?c.json({error:{code:error.code,message:error.message}},error.status):c.json({error:'unexpected'},500));
beforeEach(()=>{vi.stubEnv('JWT_SECRET','isolated-test-secret-at-least-thirty-two-characters');mocks.db.mockReset().mockResolvedValue([]);mocks.send.mockReset()});
afterEach(()=>vi.unstubAllEnvs());
const start=()=>app.request('/mobile/otp/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'+27821234567'})});
describe('mobile API security',()=>{
  it('rejects missing sessions before querying personal data',async()=>{expect((await app.request('/mobile/residence')).status).toBe(401);expect(mocks.db).not.toHaveBeenCalled()});
  it('rejects financial JWTs even when signed with the same key',async()=>{
    const token=await new SignJWT({sid:'session'}).setProtectedHeader({alg:'HS256'}).setSubject('user').setIssuer('facepay-core').setAudience('facepay-api').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    expect((await app.request('/mobile/residence',{headers:{Authorization:'Bearer '+token}})).status).toBe(401);expect(mocks.db).not.toHaveBeenCalled();
  });
  it('rejects revoked mobile sessions',async()=>{
    const token=await new SignJWT({sid:'revoked'}).setProtectedHeader({alg:'HS256'}).setSubject('user').setIssuer('facepay-mobile').setAudience('facepay-mobile').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    expect((await app.request('/mobile/residence',{headers:{Authorization:'Bearer '+token}})).status).toBe(401);expect(mocks.db).toHaveBeenCalledTimes(1);
  });
  it('encrypts personal data with authenticated, randomized ciphertext',()=>{
    const value={address:'Example address',latitude:-26.2};const a=seal(value),b=seal(value);expect(a).not.toBe(b);expect(a).not.toContain('Example');expect(unseal(a)).toEqual(value);
    const parts=a.split('.');parts[1]=Buffer.alloc(16).toString('base64url');expect(()=>unseal(parts.join('.'))).toThrow();
  });
  it('requests SMS only after Twilio confirms number unavailable on WhatsApp',async()=>{
    mocks.send.mockRejectedValueOnce(new VerifyDeliveryError(63024)).mockResolvedValueOnce({sid:'VE'+'a'.repeat(32)});
    expect((await start()).status).toBe(201);expect(mocks.send.mock.calls.map(call=>call[1].Channel)).toEqual(['whatsapp','sms']);
  });
  it('does not fall back to SMS after ambiguous failures or other provider errors',async()=>{
    for(const error of [new VerifyDeliveryError(63003),new Error('timeout')]){mocks.send.mockReset().mockRejectedValue(error);expect((await start()).status).toBe(503);expect(mocks.send).toHaveBeenCalledTimes(1);expect(mocks.send.mock.calls[0][1].Channel).toBe('whatsapp')}
  });
});
