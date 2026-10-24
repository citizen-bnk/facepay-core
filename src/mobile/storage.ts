import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { DomainError } from '../domain/rbac.js';
export function secret() { const s=process.env.JWT_SECRET;if(!s||s.length<32)throw new DomainError(503,'mobile_unconfigured','Mobile authentication is not configured');return s; }
export const mobileDb=()=>{const url=process.env.DEVELOPER_DATABASE_URL;if(!url)throw new DomainError(503,'mobile_unconfigured','Mobile storage is not configured');return neon(url)};
const dataKey=()=>Buffer.from(hkdfSync('sha256',secret(),'facepay-mobile','encrypted-mobile-data-v1',32));
export function seal(value:unknown){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',dataKey(),iv);const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),bytes].map(v=>v.toString('base64url')).join('.')}
export function unseal<T>(value:string):T {const [iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'base64url'));const cipher=createDecipheriv('aes-256-gcm',dataKey(),iv);cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8')) as T}
export const opaque=(value:string)=>createHmac('sha256',secret()).update(value).digest('hex');
export async function mobileRate(key:string,max:number,seconds:number){const now=Date.now(),bucket=opaque(key)+':'+Math.floor(now/(seconds*1000));const rows=await mobileDb()`INSERT INTO mobile_rate_limits(bucket,expires_at) VALUES(${bucket},${new Date(now+seconds*1000).toISOString()}) ON CONFLICT(bucket) DO UPDATE SET hits=mobile_rate_limits.hits+1 RETURNING hits`;if(Number(rows[0].hits)>max)throw new DomainError(429,'rate_limited','Too many attempts. Please wait before retrying.')}
