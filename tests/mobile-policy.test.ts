import { describe,it,expect } from 'vitest';
import { allowSmsFallback,classifySample,dayIndex,distanceMetres,inHomeWindow,residenceDecision } from '../src/mobile/policy.js';
const home={latitude:-26.2041,longitude:28.0473};const now=Date.parse('2026-10-24T18:00:00Z');
describe('residence evidence policy',()=>{
 it('requires completion of 15 days before a 12/15 result',()=>{expect(residenceDecision(14,12)).toBe('collecting');expect(residenceDecision(15,12)).toBe('consistent_residence_evidence');expect(residenceDecision(15,11)).toBe('insufficient_evidence')});
 it('calculates physical distance in metres',()=>{expect(distanceMetres(home,home)).toBe(0);expect(distanceMetres(home,{...home,latitude:home.latitude+.001})).toBeGreaterThan(100)});
 it('rejects stale, mocked and poor readings',()=>{const point={...home,accuracy:10,timestamp:now};expect(classifySample(home,point,now)).toBe('qualifying');expect(classifySample(home,{...point,accuracy:51},now)).toBe('poor_accuracy');expect(classifySample(home,{...point,mocked:true},now)).toBe('mock_location');expect(classifySample(home,{...point,timestamp:now-300001},now)).toBe('stale_location');expect(classifySample(home,{...point,latitude:0},now)).toBe('away_from_home')});
 it('uses calendar days in the enrollment timezone',()=>{expect(dayIndex(Date.parse('2026-10-24T21:30Z'),Date.parse('2026-10-24T22:30Z'),'Africa/Johannesburg')).toBe(1)});
 it('limits collection to a selected two-hour home window',()=>{expect(inHomeWindow(now,'Africa/Johannesburg',19)).toBe(true);expect(inHomeWindow(now,'Africa/Johannesburg',17)).toBe(false)});
});
describe('WhatsApp-only fallback policy',()=>{it('falls back only on the explicit unavailable-on-WhatsApp code',()=>{expect(allowSmsFallback(63024)).toBe(true);expect(allowSmsFallback('63024')).toBe(true);for(const code of [63003,63016,30008,500,undefined,null])expect(allowSmsFallback(code)).toBe(false)})});
