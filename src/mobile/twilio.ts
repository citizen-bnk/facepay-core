import { DomainError } from '../domain/rbac.js';
export class VerifyDeliveryError extends Error {constructor(public code:number){super('Verification provider rejected the request')}}
export async function twilio(path:string,body?:Record<string,string>):Promise<Record<string,any>> {
  const account=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN,service=process.env.TWILIO_VERIFY_SERVICE_SID;
  if(!account||!token||!service||process.env.TWILIO_STRICT_WHATSAPP_FALLBACK_CONFIRMED!=='true')throw new DomainError(503,'otp_unconfigured','WhatsApp verification requires provider credentials and confirmation of the strict SMS fallback policy.');
  let response:Response;try{response=await fetch('https://verify.twilio.com/v2/'+path.replace('{service}',service),{method:body?'POST':'GET',headers:{Authorization:'Basic '+Buffer.from(account+':'+token).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(12000)})}catch{throw new DomainError(503,'delivery_unavailable','Verification delivery could not be confirmed. No SMS fallback was requested. Please retry later.')}
  const data=await response.json() as Record<string,any>;if(!response.ok){if(response.status===429)throw new DomainError(429,'provider_rate_limited','Please wait before requesting another verification code.');throw new VerifyDeliveryError(Number(data.code))}return data;
}
