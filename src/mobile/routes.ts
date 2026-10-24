import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { DomainError } from '../domain/rbac.js';
import { jsonBody, parse } from '../api/http.js';
import { allowSmsFallback, classifySample, dayIndex, inHomeWindow, RESIDENCE_POLICY, residenceDecision, type Point } from './policy.js';
import { mobileDb, mobileRate, opaque, seal, secret, unseal } from './storage.js';
import { twilio, VerifyDeliveryError } from './twilio.js';

type MobileEnv={Variables:{userId:string;sessionId:string}};
export const mobileRoutes=new Hono<MobileEnv>();
const key=()=>new TextEncoder().encode(secret());
const path='Services/{service}/';
mobileRoutes.use('/mobile/*',async(c,next)=>{c.header('Cache-Control','no-store');if(c.req.method==='OPTIONS'||c.req.path.startsWith('/mobile/otp/')||c.req.path==='/mobile/retention')return next();
  try{const bearer=c.req.header('Authorization')||'';const {payload}=await jwtVerify(bearer.replace(/^Bearer /,''),key(),{issuer:'facepay-mobile',audience:'facepay-mobile',algorithms:['HS256']});if(!payload.sub||typeof payload.sid!=='string')throw Error();const rows=await mobileDb()`SELECT user_id FROM mobile_sessions WHERE id=${payload.sid} AND user_id=${payload.sub} AND revoked_at IS NULL AND expires_at>now()`;if(!rows.length)throw Error();c.set('userId',payload.sub);c.set('sessionId',payload.sid)}catch(error){if(error instanceof DomainError)throw error;throw new DomainError(401,'mobile_sign_in_required','Sign in with a verified phone number to continue.')};return next()});

const Start=z.object({phone:z.string().regex(/^\+[1-9]\d{7,14}$/)});
mobileRoutes.post('/mobile/otp/start',async c=>{
  const {phone}=parse(Start,await jsonBody(c));const db=mobileDb();const userId='mobile_'+opaque(phone);
  await mobileRate('otp-phone:'+userId,3,600);await mobileRate('otp-ip:'+(c.req.header('x-forwarded-for')?.split(',')[0]||'unknown'),10,600);
  let result:Record<string,any>,channel='whatsapp';
  try{result=await twilio(path+'Verifications',{To:phone,Channel:'whatsapp'})}catch(error){if(!(error instanceof VerifyDeliveryError)||!allowSmsFallback(error.code))throw error instanceof DomainError?error:new DomainError(503,'whatsapp_unavailable','WhatsApp delivery was not confirmed. SMS was not requested.');channel='sms';result=await twilio(path+'Verifications',{To:phone,Channel:'sms'})}
  if(!/^VE[a-fA-F0-9]{32}$/.test(String(result.sid)))throw new DomainError(503,'provider_error','Verification provider returned an invalid challenge.');
  const id=randomUUID();await db`INSERT INTO mobile_otp_challenges(id,user_id,phone_cipher,verification_sid,channel) VALUES(${id},${userId},${seal(phone)},${result.sid},${channel})`;
  return c.json({challengeId:id,channel,expiresIn:600},201);
});
mobileRoutes.get('/mobile/otp/status/:id',async c=>{
  const id=parse(z.string().uuid(),c.req.param('id'));await mobileRate('otp-status:'+id,6,60);const db=mobileDb();const [row]=await db`SELECT * FROM mobile_otp_challenges WHERE id=${id} AND expires_at>now() AND consumed_at IS NULL`;
  if(!row)throw new DomainError(404,'challenge_expired','Request a new verification code.');
  if(row.channel!=='whatsapp')return c.json({channel:row.channel==='sms'?'sms':'whatsapp'});
  const verification=await twilio(path+'Verifications/'+row.verification_sid);
  const attempts=(verification.send_code_attempts||[]) as {attempt_sid?:string;channel?:string}[];
  const attempt=attempts.slice().reverse().find(a=>a.channel==='whatsapp'&&/^VL[a-fA-F0-9]{32}$/.test(a.attempt_sid||''));
  if(attempt){const record=await twilio('Attempts/'+attempt.attempt_sid);const data=record.channel_data||{};
    if(record.channel==='whatsapp'&&(record.verification_sid===row.verification_sid||data.verification_sid===row.verification_sid)&&allowSmsFallback(data.error_code)){
      const claimed=await db`UPDATE mobile_otp_challenges SET channel='sms_starting' WHERE id=${id} AND channel='whatsapp' AND consumed_at IS NULL AND expires_at>now() RETURNING id`;
      if(claimed.length){const sent=await twilio(path+'Verifications',{To:unseal<string>(row.phone_cipher),Channel:'sms'});await db`UPDATE mobile_otp_challenges SET channel='sms',verification_sid=${sent.sid} WHERE id=${id}`;return c.json({channel:'sms'})}
    }
  }
  return c.json({channel:'whatsapp'});
});
mobileRoutes.post('/mobile/otp/verify',async c=>{
  const {challengeId,code}=parse(z.object({challengeId:z.string().uuid(),code:z.string().regex(/^\d{4,10}$/)}),await jsonBody(c));const db=mobileDb();
  const [row]=await db`UPDATE mobile_otp_challenges SET attempts=attempts+1 WHERE id=${challengeId} AND expires_at>now() AND consumed_at IS NULL AND attempts<5 RETURNING *`;
  if(!row)throw new DomainError(401,'invalid_challenge','Code expired or too many attempts. Request a new code.');
  const result=await twilio(path+'VerificationCheck',{VerificationSid:row.verification_sid,Code:code});
  if(result.status!=='approved')throw new DomainError(401,'invalid_otp','That verification code is incorrect.');
  const used=await db`UPDATE mobile_otp_challenges SET consumed_at=now(),phone_cipher='' WHERE id=${challengeId} AND consumed_at IS NULL RETURNING id`;
  if(!used.length)throw new DomainError(401,'used_challenge','This verification code was already used.');
  const sid=randomUUID();await db`INSERT INTO mobile_sessions(id,user_id) VALUES(${sid},${row.user_id})`;
  const token=await new SignJWT({sid}).setProtectedHeader({alg:'HS256'}).setSubject(row.user_id).setIssuer('facepay-mobile').setAudience('facepay-mobile').setIssuedAt().setExpirationTime('30d').sign(key());
  return c.json({token,expiresIn:2592000,user:{id:row.user_id,name:'FacePay member'}});
});
mobileRoutes.delete('/mobile/session',async c=>{await mobileDb()`UPDATE mobile_sessions SET revoked_at=now() WHERE id=${c.get('sessionId')}`;return c.json({revoked:true})});
mobileRoutes.delete('/mobile/account',async c=>{
  const db=mobileDb(),userId=c.get('userId');
  await db.transaction([
    db`DELETE FROM mobile_residence WHERE user_id=${userId}`,
    db`DELETE FROM mobile_otp_challenges WHERE user_id=${userId}`,
    db`DELETE FROM mobile_sessions WHERE user_id=${userId}`,
  ]);
  return c.json({deleted:true,collectionStopped:true});
});

const Coordinates=z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)});
const PointSchema=Coordinates.extend({accuracy:z.number().nonnegative(),timestamp:z.number(),mocked:z.boolean().optional()});
async function enrollment(userId:string){const rows=await mobileDb()`SELECT * FROM mobile_residence WHERE user_id=${userId} AND revoked_at IS NULL AND created_at>now()-interval '30 days'`;if(!rows[0])throw new DomainError(404,'not_enrolled','No active residence verification.');return rows[0]}
mobileRoutes.post('/mobile/residence',async c=>{
  const body=parse(z.object({address:z.string().trim().min(12).max(500),home:Coordinates,timezone:z.string().max(80),homeHour:z.number().int().min(0).max(23),consent:z.literal(true),consentVersion:z.literal(RESIDENCE_POLICY.consentVersion)}),await jsonBody(c));
  try{new Intl.DateTimeFormat('en',{timeZone:body.timezone}).format()}catch{throw new DomainError(422,'timezone_invalid','Select a valid local timezone.')}
  const db=mobileDb();const existing=await db`SELECT id FROM mobile_residence WHERE user_id=${c.get('userId')} AND revoked_at IS NULL AND created_at>now()-interval '30 days'`;
  if(existing.length)throw new DomainError(409,'already_enrolled','Stop the existing check before starting another.');
  await db`DELETE FROM mobile_residence WHERE user_id=${c.get('userId')}`;
  const id=randomUUID();await db`INSERT INTO mobile_residence(id,user_id,address_cipher,anchor_cipher,timezone,home_hour,consent_version) VALUES(${id},${c.get('userId')},${seal(body.address)},${seal(body.home)},${body.timezone},${body.homeHour},${body.consentVersion})`;
  return c.json({id,policy:RESIDENCE_POLICY,status:'collecting'},201);
});
mobileRoutes.get('/mobile/residence',async c=>{
  const row=await enrollment(c.get('userId'));const samples=await mobileDb()`SELECT day_index,qualifies,reason,created_at FROM mobile_residence_samples WHERE enrollment_id=${row.id} ORDER BY day_index`;
  const days=Math.max(0,dayIndex(Date.parse(row.created_at),Date.now(),row.timezone,row.home_hour));const qualifying=samples.filter(s=>s.qualifies).length;
  return c.json({id:row.id,address:unseal<string>(row.address_cipher),timezone:row.timezone,homeHour:row.home_hour,startedAt:row.created_at,elapsedDays:Math.min(days,15),qualifyingDays:qualifying,scorePercent:Math.round(qualifying/15*100),status:residenceDecision(days,qualifying),samples,policy:RESIDENCE_POLICY});
});
mobileRoutes.post('/mobile/residence/sample',async c=>{
  const point=parse(PointSchema,await jsonBody(c)) as Point;const row=await enrollment(c.get('userId'));const now=Date.now();const day=dayIndex(Date.parse(row.created_at),now,row.timezone,row.home_hour);
  if(day<0||day>=15)throw new DomainError(409,'collection_ended','The 15-day collection period is complete.');
  if(!inHomeWindow(now,row.timezone,row.home_hour))throw new DomainError(409,'outside_home_window','Check during your selected two-hour home window.');
  const reason=classifySample(unseal(row.anchor_cipher),point,now);
  const rows=await mobileDb()`INSERT INTO mobile_residence_samples(enrollment_id,day_index,qualifies,reason,sample_cipher) VALUES(${row.id},${day},${reason==='qualifying'},${reason},${seal(point)}) ON CONFLICT(enrollment_id,day_index) DO UPDATE SET qualifies=EXCLUDED.qualifies,reason=EXCLUDED.reason,sample_cipher=EXCLUDED.sample_cipher,created_at=now() WHERE mobile_residence_samples.qualifies=false RETURNING qualifies`;
  return c.json({day:day+1,qualifies:rows[0]?.qualifies??true,reason:rows.length?reason:'already_recorded'});
});
mobileRoutes.get('/mobile/residence/report',async c=>{
  const row=await enrollment(c.get('userId'));const days=dayIndex(Date.parse(row.created_at),Date.now(),row.timezone,row.home_hour);if(days<15)throw new DomainError(409,'not_complete','The report is available after the full 15-day period.');
  const rows=await mobileDb()`SELECT day_index,qualifies,created_at FROM mobile_residence_samples WHERE enrollment_id=${row.id} ORDER BY day_index`;const count=rows.filter(r=>r.qualifies).length;
  const report={id:row.id,type:'device-reported-residence-evidence',address:unseal<string>(row.address_cipher),startedAt:row.created_at,issuedAt:new Date().toISOString(),qualifyingDays:count,totalDays:15,scorePercent:Math.round(count/15*100),decision:residenceDecision(15,count),policy:RESIDENCE_POLICY,method:'Device-geocoded address and device-reported coordinates; independent address review required. GPS spoofing cannot be ruled out.',notice:'Evidence of location consistency. Acceptance as proof of address depends on the receiving institution.'};
  const signature=await new SignJWT({report}).setProtectedHeader({alg:'HS256'}).setIssuer('facepay-mobile').setAudience('facepay-residence-evidence').setIssuedAt().setExpirationTime('30d').sign(key());return c.json({report,signature});
});
mobileRoutes.delete('/mobile/residence',async c=>{await mobileDb()`DELETE FROM mobile_residence WHERE user_id=${c.get('userId')}`;return c.json({deleted:true,collectionStopped:true})});
mobileRoutes.get('/mobile/retention',async c=>{
  if(!process.env.CRON_SECRET||c.req.header('Authorization')!=='Bearer '+process.env.CRON_SECRET)throw new DomainError(401,'unauthenticated','Not authorised');
  const db=mobileDb();await db`DELETE FROM mobile_residence WHERE created_at<now()-interval '29 days'`;await db`DELETE FROM mobile_otp_challenges WHERE expires_at<now()`;await db`DELETE FROM mobile_sessions WHERE expires_at<now() OR revoked_at IS NOT NULL`;await db`DELETE FROM mobile_rate_limits WHERE expires_at<now()`;return c.json({purged:true});
});
