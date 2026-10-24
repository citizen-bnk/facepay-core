export type Point = { latitude: number; longitude: number; accuracy: number; timestamp: number; mocked?: boolean };
export const RESIDENCE_POLICY = { days: 15, minimumDays: 12, accuracyMetres: 50, radiusMetres: 100, windowHours: 2, retentionDays: 30, consentVersion: 'residence-v1-2026-10' } as const;
export function distanceMetres(a: Pick<Point,'latitude'|'longitude'>, b: Pick<Point,'latitude'|'longitude'>) {
  const radians=(n:number)=>n*Math.PI/180; const dlat=radians(b.latitude-a.latitude),dlon=radians(b.longitude-a.longitude);
  const h=Math.sin(dlat/2)**2+Math.cos(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.sin(dlon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function classifySample(home: Pick<Point,'latitude'|'longitude'>, point: Point, now=Date.now()) {
  if (![home.latitude,home.longitude,point.latitude,point.longitude,point.accuracy,point.timestamp].every(Number.isFinite) || Math.abs(point.latitude)>90 || Math.abs(point.longitude)>180) return 'invalid';
  if (point.mocked) return 'mock_location';
  if (point.timestamp>now+30000 || now-point.timestamp>300000) return 'stale_location';
  if (point.accuracy<0 || point.accuracy>RESIDENCE_POLICY.accuracyMetres) return 'poor_accuracy';
  return distanceMetres(home,point)<=RESIDENCE_POLICY.radiusMetres ? 'qualifying' : 'away_from_home';
}
function localDate(timestamp:number,timezone:string) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(timestamp);
  const get=(type:string)=>Number(parts.find(p=>p.type===type)!.value);
  return Date.UTC(get('year'),get('month')-1,get('day'));
}
export function dayIndex(start:number, now:number, timezone:string, homeHour=0) {
 const date=(time:number)=>{const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'}).format(time));return localDate(time,timezone)-(homeHour===23&&hour===0?86400000:0)};
 return Math.floor((date(now)-date(start))/86400000);
}
export function inHomeWindow(now:number,timezone:string,hour:number) {
  const h=Number(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'}).format(now));
  return (h-hour+24)%24<RESIDENCE_POLICY.windowHours;
}
export function residenceDecision(elapsedDays:number, qualifyingDays:number) { return elapsedDays<15 ? 'collecting' : qualifyingDays>=12 ? 'consistent_residence_evidence' : 'insufficient_evidence'; }
export function allowSmsFallback(code:unknown) { return Number(code)===63024; }
