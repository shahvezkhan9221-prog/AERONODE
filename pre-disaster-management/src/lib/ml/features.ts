import { Readings, SensorKey } from '../types';
/** Temporal feature extraction shared by training and serving.
 * The rule engine in fusion.ts reads one instantaneous sample. The model reads a
 * WINDOW-sample trajectory, so it can see duration, slope, chatter and co-activation —
 * the properties that separate a real onset from a passing nuisance.
 * Training and inference MUST use this one module; a second copy is training/serving skew.
 */
export const WINDOW = 20; // samples ≈ 30 s at the 1.5 s monitor tick
export const MIN_SAMPLES = 4; // fewer valid samples in the window and the model abstains
export type ModelId = 'node-1' | 'node-2';
export interface Sample { time: number; sensors: Readings }
export type FeatureFormat = 'g' | 'percent' | 'share' | 'gPerSecond' | 'percentPerSecond' | 'count';
export interface FeatureSpec { id: string; label: string; format: FeatureFormat }

const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const peak = (a: number[]) => a.length ? Math.max(...a) : 0;
const last = (a: number[]) => a.length ? a[a.length - 1] : 0;
const shareAbove = (a: number[], threshold: number) => a.length ? a.filter(x => x >= threshold).length / a.length : 0;
/** Least-squares trend in units per second; 0 when the window is too short or flat in time. */
const slope = (t: number[], v: number[]) => { if (v.length < 2) return 0; const mt = mean(t), mv = mean(v); let num = 0, den = 0; for (let i = 0; i < v.length; i++) { num += (t[i] - mt) * (v[i] - mv); den += (t[i] - mt) ** 2; } return den > 0 ? num / den : 0; };
/** Rising 0→1 transitions per transition opportunity: distinguishes one sustained trip from repeated chatter. */
const edgeRate = (v: number[]) => { if (v.length < 2) return 0; let n = 0; for (let i = 1; i < v.length; i++) if (v[i] === 1 && v[i - 1] === 0) n++; return n / (v.length - 1); };

function series(samples: Sample[], key: SensorKey) {
 const t: number[] = [], v: number[] = [];
 for (const s of samples) { const value = s.sensors[key]; if (value == null || !Number.isFinite(value)) continue; t.push(s.time / 1000); v.push(value); }
 return { t, v };
}
/** Share of samples where a predicate holds across two aligned sensors (missing readings never count as evidence). */
function coShare(samples: Sample[], test: (r: Readings) => boolean) { const usable = samples.filter(s => Object.values(s.sensors).some(v => v != null)); return usable.length ? usable.filter(s => test(s.sensors)).length / usable.length : 0; }

export const featureSpec: Record<ModelId, FeatureSpec[]> = {
 'node-1': [
  { id: 'accel_now', label: 'Acceleration now', format: 'g' },
  { id: 'accel_mean', label: 'Mean acceleration', format: 'g' },
  { id: 'accel_max', label: 'Peak acceleration', format: 'g' },
  { id: 'accel_std', label: 'Acceleration variability', format: 'g' },
  { id: 'accel_slope', label: 'Acceleration trend', format: 'gPerSecond' },
  { id: 'accel_share_high', label: 'Time above 0.15 g', format: 'share' },
  { id: 'shock_duty', label: 'Shock trip duty cycle', format: 'share' },
  { id: 'shock_edges', label: 'Shock re-trigger rate', format: 'share' },
  { id: 'sound_duty', label: 'Acoustic duty cycle', format: 'share' },
  { id: 'sound_edges', label: 'Acoustic re-trigger rate', format: 'share' },
  { id: 'co_active', label: 'Two or more signals together', format: 'share' },
  { id: 'votes_now', label: 'Signals active right now', format: 'count' }
 ],
 'node-2': [
  { id: 'moist_now', label: 'Soil moisture now', format: 'percent' },
  { id: 'moist_mean', label: 'Mean soil moisture', format: 'percent' },
  { id: 'moist_max', label: 'Peak soil moisture', format: 'percent' },
  { id: 'moist_std', label: 'Soil moisture variability', format: 'percent' },
  { id: 'moist_slope', label: 'Soil moisture trend', format: 'percentPerSecond' },
  { id: 'moist_share_high', label: 'Time above 65% moisture', format: 'share' },
  { id: 'rain_now', label: 'Rain wetness now', format: 'percent' },
  { id: 'rain_mean', label: 'Mean rain wetness', format: 'percent' },
  { id: 'rain_max', label: 'Peak rain wetness', format: 'percent' },
  { id: 'rain_slope', label: 'Rain wetness trend', format: 'percentPerSecond' },
  { id: 'rain_share_high', label: 'Time above 40% wetness', format: 'share' },
  { id: 'float_duty', label: 'Float switch duty cycle', format: 'share' },
  { id: 'float_edges', label: 'Float switch chatter', format: 'share' },
  { id: 'wet_co', label: 'Rain and saturation together', format: 'share' }
 ]
};

export function formatFeature(format: FeatureFormat, value: number): string {
 if (format === 'g') return `${value.toFixed(3)} g`;
 if (format === 'percent') return `${value.toFixed(1)}%`;
 if (format === 'share') return `${Math.round(value * 100)}% of window`;
 if (format === 'gPerSecond') return `${value >= 0 ? '+' : ''}${value.toFixed(4)} g/s`;
 if (format === 'percentPerSecond') return `${value >= 0 ? '+' : ''}${value.toFixed(2)} %/s`;
 return value.toFixed(1);
}

/** Returns the feature vector for the most recent WINDOW samples, or null when coverage is too thin to model. */
export function featurize(nodeId: ModelId, history: Sample[]): { values: number[]; samples: number } | null {
 const window = history.slice(-WINDOW);
 const usable = window.filter(s => Object.values(s.sensors).some(v => v != null && Number.isFinite(v)));
 if (usable.length < MIN_SAMPLES) return null;
 if (nodeId === 'node-1') {
  const accel = series(window, 'acceleration'), shock = series(window, 'shock'), sound = series(window, 'sound');
  const votes = (r: Readings) => ((r.acceleration ?? 0) >= .15 ? 1 : 0) + (r.shock === 1 ? 1 : 0) + (r.sound === 1 ? 1 : 0);
  const latest = window[window.length - 1].sensors;
  return { samples: usable.length, values: [
   last(accel.v), mean(accel.v), peak(accel.v), std(accel.v), slope(accel.t, accel.v), shareAbove(accel.v, .15),
   mean(shock.v), edgeRate(shock.v), mean(sound.v), edgeRate(sound.v),
   coShare(window, r => votes(r) >= 2), votes(latest)
  ] };
 }
 const moist = series(window, 'moisture'), rain = series(window, 'rain'), float = series(window, 'float');
 return { samples: usable.length, values: [
  last(moist.v), mean(moist.v), peak(moist.v), std(moist.v), slope(moist.t, moist.v), shareAbove(moist.v, 65),
  last(rain.v), mean(rain.v), peak(rain.v), slope(rain.t, rain.v), shareAbove(rain.v, 40),
  mean(float.v), edgeRate(float.v), coShare(window, r => (r.rain ?? 0) >= 40 && (r.moisture ?? 0) >= 65)
 ] };
}
