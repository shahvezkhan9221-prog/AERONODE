import { Hazard, Readings, Tier } from './types';
/** SENTINEL-MESH explainable prototype rules, NOT calibrated hazard probabilities.
 * Acceleration is gravity-removed peak deviation in g (not raw 1g magnitude).
 * Rain is normalized pad wetness 0–100, NOT mm/hour. Moisture is demo-calibrated %.
 * Earthquake: accel >= .15g, SW-420=1, LM393=1 are independent votes.
 * 0 votes Normal (baseline 8); 1 Watch (35); 2 Warning (68); 3 Critical (92)
 * only if peak >= .6g, otherwise Warning (78).
 * Flood: float=1 alone or wetness>=40 alone => Watch; both => Warning (72).
 * Critical (94) additionally requires soil saturation >=85 and rain>=75.
 * Rain/soil corroborate environmental context; neither is a backup water-level sensor.
 * All Warning/Critical paths require >=2 independent physical signals.
 * PIR is intentionally never read here. Null readings supply no evidence.
 * Tiers describe prototype sensor evidence, not confirmed earthquakes or floods.
 */
export function fuse(nodeId: string, r: Readings): Hazard[] {
 const moisture = r.moisture ?? 0, rain = r.rain ?? 0;
 if (nodeId === 'node-1') {
  const contributors = [((r.acceleration ?? 0) >= .15) && 'Accelerometer deviation ≥ 0.15 g', r.shock === 1 && 'SW-420 shock trip', r.sound === 1 && 'LM393 sound threshold crossed'].filter(Boolean) as string[];
  const n = contributors.length;
  const tier: Tier = n === 0 ? 'Normal' : n === 1 ? 'Watch' : n === 3 && (r.acceleration ?? 0) >= .6 ? 'Critical' : 'Warning';
  return [{ type: 'Seismic', score: n === 0 ? 8 : n === 1 ? 35 : tier === 'Critical' ? 92 : n === 3 ? 78 : 68, tier, contributors, total: 3, explanation: n === 0 ? 'No corroborating seismic signals. All readings are within baseline.' : n === 1 ? 'One signal only. Informational watch; insufficient corroboration to alert.' : `${n}/3 independent signals corroborate a vibration event. ${tier === 'Critical' ? 'Peak deviation also exceeds 0.60 g.' : 'Cross-sensor agreement meets the warning rule.'}` }];
 }
 const floodSignals = [r.float === 1 && 'Float switch activated', rain >= 40 && 'Rain pad wetness ≥ 40%', moisture >= 85 && r.float === 1 && rain >= 40 && 'Soil saturation ≥ 85%'].filter(Boolean) as string[];
 const floodTier: Tier = r.float === 1 && rain >= 40 ? moisture >= 85 && rain >= 75 ? 'Critical' : 'Warning' : r.float === 1 || rain >= 40 ? 'Watch' : 'Normal';
 return [
  { type: 'Flood', tier: floodTier, score: { Normal: 12, Watch: 36, Warning: 72, Critical: 94 }[floodTier], contributors: floodSignals, total: 3, explanation: floodTier === 'Normal' ? 'Float switch is clear. No corroborating flood evidence.' : floodTier === 'Watch' ? 'Only one hazard signal is active; no warning is issued.' : 'Float switch is corroborated by rainfall. Only one direct water-level sensor exists; rainfall is context, not a redundant level measurement.' }
 ];
}
