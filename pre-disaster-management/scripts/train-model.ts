/** SENTINEL-MESH model trainer.
 *
 * Builds the advisory ML layer that ships in src/lib/ml/model.ts. Two heads per node:
 *   1. a softmax classifier over physical states, including nuisance states the
 *      instantaneous rule engine cannot represent (machinery noise, irrigation, a stuck float);
 *   2. a logistic early-warning head estimating the probability that the documented rules in
 *      fusion.ts will reach Warning or above within the next 30 seconds.
 *
 * TRAINING DATA IS SYNTHETIC. No real earthquake or flood telemetry was available for
 * this prototype, so episodes come from the seeded generator below: ramped onsets, sensor noise,
 * per-episode calibration offsets, packet dropout and deliberate nuisance events. Reported metrics
 * are therefore held-out synthetic metrics and are NOT evidence of real-world detection skill.
 *
 * Run:  npm run train
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fuse } from '../src/lib/fusion';
import { Readings, tierRank } from '../src/lib/types';
import { MIN_SAMPLES, ModelId, WINDOW, featureSpec, featurize } from '../src/lib/ml/features';
import { ClassMetric, ClassSpec, ModelBundle, NodeModel } from '../src/lib/ml/schema';

const SEED = 20260911;
const TICK = 1.5; // seconds between monitor samples
const HORIZON = 30; // early-warning horizon in seconds
const HORIZON_STEPS = Math.round(HORIZON / TICK);
const EPISODE_STEPS = 150; // 225 s per episode
const EPISODES_PER_CLASS = 130;
const MAX_ROWS = 42000;
const ITERATIONS = 260;

let seed = SEED >>> 0;
const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const uniform = (lo: number, hi: number) => lo + rand() * (hi - lo);
const gauss = (mu: number, sigma: number) => { const u = Math.max(rand(), 1e-9), v = rand(); return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const chance = (p: number) => rand() < p;

const classes: Record<ModelId, ClassSpec[]> = {
 'node-1': [
  { id: 'baseline', label: 'Baseline', hazard: false, description: 'Ambient vibration only. No onset pattern in the window.' },
  { id: 'seismic', label: 'Seismic event', hazard: true, description: 'Sustained acceleration envelope corroborated by the shock and acoustic comparators.' },
  { id: 'machinery', label: 'Machinery or traffic', hazard: false, description: 'Repeated shock and acoustic trips with low peak acceleration: the signature of nearby vehicles or plant, not ground motion.' },
  { id: 'disturbance', label: 'Node disturbance', hazard: false, description: 'Isolated acceleration spikes with no envelope. The node itself was knocked or handled.' }
 ],
 'node-2': [
  { id: 'baseline', label: 'Baseline', hazard: false, description: 'Soil moisture and rain pad are within their settled range.' },
  { id: 'flood', label: 'Flooding', hazard: true, description: 'Rising rain wetness and soil saturation with the float switch carrying water level.' },
  { id: 'irrigation', label: 'Local wetting', hazard: false, description: 'Soil moisture rising on its own while the rain pad stays dry: irrigation, a leak, or a hose.' },
  { id: 'shower', label: 'Passing shower', hazard: false, description: 'A short rain spike that decays without meaningfully saturating the soil.' },
  { id: 'float_fault', label: 'Float switch fault', hazard: false, description: 'Float switch reads high while rain and soil stay dry: a jammed or debris-held float.' }
 ]
};

interface Step { sensors: Readings; active: boolean }
type Episode = { nodeId: ModelId; klass: string; steps: Step[] };

/** Gravity-removed acceleration envelope: linear rise to peak, exponential decay. */
function seismicEpisode(): Step[] {
 const onset = Math.round(uniform(18, 46)), amplitude = uniform(.22, 1.5), rise = uniform(5, 24), decay = uniform(14, 55);
 return Array.from({ length: EPISODE_STEPS }, (_, i) => {
  const dt = (i - onset) * TICK;
  const envelope = dt < 0 ? 0 : dt < rise ? amplitude * (dt / rise) : amplitude * Math.exp(-(dt - rise) / decay);
  const acceleration = clamp(gauss(.022 + envelope, .012 + .035 * envelope), 0, 32);
  return { active: envelope >= .06, sensors: { acceleration: Math.round(acceleration * 1000) / 1000, shock: (envelope >= .12 && chance(.88)) || chance(.004) ? 1 : 0, sound: (envelope >= .28 && chance(.82)) || chance(.004) ? 1 : 0 } };
 });
}
/** Traffic or a generator: the comparators trip repeatedly but the accelerometer never builds an envelope. */
function machineryEpisode(): Step[] {
 const bursts = Array.from({ length: Math.round(uniform(2, 5)) }, () => { const start = Math.round(uniform(6, EPISODE_STEPS - 20)); return { start, end: start + Math.round(uniform(3, 14)) }; });
 return Array.from({ length: EPISODE_STEPS }, (_, i) => {
  const inside = bursts.some(b => i >= b.start && i <= b.end);
  return { active: bursts.some(b => i >= b.start && i <= b.end + 1), sensors: {
   acceleration: Math.round(clamp(gauss(inside ? .055 : .022, inside ? .028 : .011), 0, 32) * 1000) / 1000,
   shock: inside && chance(.55) ? 1 : chance(.004) ? 1 : 0,
   sound: inside && chance(.5) ? 1 : chance(.004) ? 1 : 0
  } };
 });
}
/** Someone bumped the enclosure: one or two single-sample spikes, no sustained motion. */
function disturbanceEpisode(): Step[] {
 const spikes = Array.from({ length: Math.round(uniform(1, 3)) }, () => Math.round(uniform(10, EPISODE_STEPS - 10)));
 return Array.from({ length: EPISODE_STEPS }, (_, i) => {
  const hit = spikes.some(s => i === s || (chance(.35) && i === s + 1));
  return { active: spikes.some(s => i >= s && i <= s + 1), sensors: {
   acceleration: Math.round(clamp(hit ? uniform(.3, 1.4) : gauss(.022, .011), 0, 32) * 1000) / 1000,
   shock: hit && chance(.7) ? 1 : chance(.004) ? 1 : 0,
   sound: hit && chance(.15) ? 1 : chance(.004) ? 1 : 0
  } };
 });
}
function seismicBaseline(): Step[] { return Array.from({ length: EPISODE_STEPS }, () => ({ active: false, sensors: { acceleration: Math.round(clamp(gauss(.022, .011), 0, 32) * 1000) / 1000, shock: chance(.004) ? 1 : 0, sound: chance(.004) ? 1 : 0 } })); }

/** Shared hydrology skeleton: every node-2 class is a pair of moisture/rain trajectories plus a float rule. */
function hydroEpisode(klass: string): Step[] {
 const moistBase = clamp(gauss(38, 3.5), 24, 52), rainBase = clamp(gauss(7, 2.5), 0, 16);
 const onset = Math.round(uniform(14, 44));
 const moistTarget = klass === 'flood' ? uniform(68, 96) : klass === 'irrigation' ? uniform(68, 93) : moistBase + (klass === 'shower' ? uniform(2, 9) : 0);
 const rainTarget = klass === 'flood' ? uniform(55, 98) : klass === 'shower' ? uniform(45, 82) : rainBase;
 const moistRamp = klass === 'irrigation' ? uniform(20, 55) : uniform(45, 130), rainRamp = klass === 'shower' ? uniform(9, 24) : uniform(30, 95);
 const showerDecay = uniform(25, 60), floatOnset = onset + Math.round(uniform(14, 48) / TICK);
 return Array.from({ length: EPISODE_STEPS }, (_, i) => {
  const dt = (i - onset) * TICK, progressed = dt > 0;
  const moistProgress = progressed ? Math.min(1, dt / moistRamp) : 0;
  const rainShape = !progressed ? 0 : klass === 'shower' ? (dt < rainRamp ? dt / rainRamp : Math.exp(-(dt - rainRamp) / showerDecay)) : Math.min(1, dt / rainRamp);
  const moisture = clamp(gauss(moistBase + (moistTarget - moistBase) * moistProgress, 1.3), 0, 100);
  const rain = clamp(gauss(rainBase + (rainTarget - rainBase) * rainShape, 2.2), 0, 100);
  const float = klass === 'flood' ? (i >= floatOnset && !chance(.04) ? 1 : 0) : klass === 'float_fault' ? (chance(.03) ? 0 : 1) : chance(.002) ? 1 : 0;
  return { active: klass === 'float_fault' ? true : progressed && (moistProgress > .04 || rainShape > .04), sensors: { moisture: Math.round(moisture * 10) / 10, rain: Math.round(rain * 10) / 10, float, pir: chance(.08) ? 1 : 0 } };
 });
}

function buildEpisode(nodeId: ModelId, klass: string): Episode {
 const steps = nodeId === 'node-1'
  ? klass === 'seismic' ? seismicEpisode() : klass === 'machinery' ? machineryEpisode() : klass === 'disturbance' ? disturbanceEpisode() : seismicBaseline()
  : hydroEpisode(klass);
 // Packet loss: isolated dropped readings plus occasional multi-sample radio gaps.
 for (let i = 0; i < steps.length; i++) {
  if (chance(.01)) { const gap = Math.round(uniform(1, 5)); for (let j = i; j < Math.min(steps.length, i + gap); j++) steps[j] = { ...steps[j], sensors: Object.fromEntries(Object.keys(steps[j].sensors).map(k => [k, null])) }; i += gap; continue; }
  for (const key of Object.keys(steps[i].sensors)) if (chance(.012)) steps[i] = { ...steps[i], sensors: { ...steps[i].sensors, [key]: null } };
 }
 return { nodeId, klass, steps };
}

interface Row { values: number[]; klass: number; escalation: number | null }
/** Rule tier for a reading: both the escalation target and the honest baseline the model is measured against. */
const ruleRank = (nodeId: ModelId, sensors: Readings) => Math.max(...fuse(nodeId, sensors).map(h => tierRank[h.tier]));

function extractRows(nodeId: ModelId, episodes: Episode[]) {
 const rows: Row[] = [];
 const ids = classes[nodeId].map(c => c.id);
 for (const episode of episodes) {
  const history = episode.steps.map((s, i) => ({ time: i * TICK * 1000, sensors: s.sensors }));
  const ranks = episode.steps.map(s => ruleRank(nodeId, s.sensors));
  for (let i = MIN_SAMPLES; i < history.length; i++) {
   const features = featurize(nodeId, history.slice(0, i + 1));
   if (!features) continue;
   const windowActive = episode.steps.slice(Math.max(0, i - WINDOW + 1), i + 1).some(s => s.active);
   const klass = ids.indexOf(windowActive ? episode.klass : 'baseline');
   const escalation = ranks[i] >= 2 ? null : ranks.slice(i + 1, i + 1 + HORIZON_STEPS).some(r => r >= 2) ? 1 : 0;
   rows.push({ values: features.values, klass, escalation });
  }
 }
 return rows;
}

const dot = (w: number[], x: number[]) => { let s = 0; for (let i = 0; i < w.length; i++) s += w[i] * x[i]; return s; };
const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));
function softmax(z: number[]) { const m = Math.max(...z); const e = z.map(v => Math.exp(v - m)); const sum = e.reduce((a, b) => a + b, 0); return e.map(v => v / sum); }

/** Full-batch gradient descent with Adam, L2 regularisation and inverse-frequency class weights. */
function trainSoftmax(x: number[][], y: number[], k: number, lr = .09, l2 = 2e-4) {
 const f = x[0].length, w = Array.from({ length: k }, () => new Array(f).fill(0)), b = new Array(k).fill(0);
 const mW = w.map(r => r.map(() => 0)), vW = w.map(r => r.map(() => 0)), mB = new Array(k).fill(0), vB = new Array(k).fill(0);
 const counts = new Array(k).fill(0);
 for (const label of y) counts[label]++;
 const weightFor = counts.map(c => (c ? y.length / (k * c) : 0));
 for (let step = 1; step <= ITERATIONS; step++) {
  const gW = w.map(r => r.map(() => 0)), gB = new Array(k).fill(0);
  let total = 0;
  for (let n = 0; n < x.length; n++) {
   const sample = x[n], weight = weightFor[y[n]];
   total += weight;
   const p = softmax(w.map((row, c) => dot(row, sample) + b[c]));
   for (let c = 0; c < k; c++) { const d = weight * (p[c] - (y[n] === c ? 1 : 0)); const row = gW[c]; for (let j = 0; j < f; j++) row[j] += d * sample[j]; gB[c] += d; }
  }
  const biasCorrection1 = 1 - Math.pow(.9, step), biasCorrection2 = 1 - Math.pow(.999, step);
  for (let c = 0; c < k; c++) {
   for (let j = 0; j < f; j++) {
    const g = gW[c][j] / total + l2 * w[c][j];
    mW[c][j] = .9 * mW[c][j] + .1 * g; vW[c][j] = .999 * vW[c][j] + .001 * g * g;
    w[c][j] -= lr * (mW[c][j] / biasCorrection1) / (Math.sqrt(vW[c][j] / biasCorrection2) + 1e-8);
   }
   const g = gB[c] / total;
   mB[c] = .9 * mB[c] + .1 * g; vB[c] = .999 * vB[c] + .001 * g * g;
   b[c] -= lr * (mB[c] / biasCorrection1) / (Math.sqrt(vB[c] / biasCorrection2) + 1e-8);
  }
 }
 return { w, b };
}
function trainLogistic(x: number[][], y: number[], lr = .09, l2 = 2e-4) {
 const f = x[0].length, w = new Array(f).fill(0), m = new Array(f).fill(0), v = new Array(f).fill(0);
 let b = 0, mB = 0, vB = 0;
 const positives = y.reduce((a, c) => a + c, 0), negatives = y.length - positives;
 const weightFor = [negatives ? y.length / (2 * negatives) : 1, positives ? y.length / (2 * positives) : 1];
 for (let step = 1; step <= ITERATIONS; step++) {
  const g = new Array(f).fill(0);
  let gB = 0, total = 0;
  for (let n = 0; n < x.length; n++) {
   const weight = weightFor[y[n]];
   total += weight;
   const d = weight * (sigmoid(dot(w, x[n]) + b) - y[n]);
   for (let j = 0; j < f; j++) g[j] += d * x[n][j];
   gB += d;
  }
  const biasCorrection1 = 1 - Math.pow(.9, step), biasCorrection2 = 1 - Math.pow(.999, step);
  for (let j = 0; j < f; j++) {
   const grad = g[j] / total + l2 * w[j];
   m[j] = .9 * m[j] + .1 * grad; v[j] = .999 * v[j] + .001 * grad * grad;
   w[j] -= lr * (m[j] / biasCorrection1) / (Math.sqrt(v[j] / biasCorrection2) + 1e-8);
  }
  const grad = gB / total;
  mB = .9 * mB + .1 * grad; vB = .999 * vB + .001 * grad * grad;
  b -= lr * (mB / biasCorrection1) / (Math.sqrt(vB / biasCorrection2) + 1e-8);
 }
 return { w, b };
}

function auc(scores: number[], labels: number[]) {
 const order = scores.map((s, i) => [s, labels[i]] as const).sort((a, b) => a[0] - b[0]);
 let rankSum = 0, positives = 0, i = 0;
 while (i < order.length) {
  let j = i;
  while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
  const rank = (i + j + 2) / 2;
  for (let r = i; r <= j; r++) if (order[r][1] === 1) { rankSum += rank; positives++; }
  i = j + 1;
 }
 const negatives = order.length - positives;
 return positives && negatives ? (rankSum - positives * (positives + 1) / 2) / (positives * negatives) : .5;
}

/** Picks the operating point that maximises F1 on the split it is given. */
function bestThreshold(scores: number[], labels: number[]) {
 let best = .5, bestF1 = -1;
 for (let t = .05; t <= .95; t += .01) {
  let tp = 0, fp = 0, fn = 0;
  scores.forEach((s, i) => { const hit = s >= t; if (hit && labels[i] === 1) tp++; else if (hit) fp++; else if (labels[i] === 1) fn++; });
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  if (f1 > bestF1) { bestF1 = f1; best = Math.round(t * 100) / 100; }
 }
 return best;
}

function buildNodeModel(nodeId: ModelId): NodeModel {
 const specs = classes[nodeId];
 const episodes: Episode[] = [];
 for (const spec of specs) for (let i = 0; i < EPISODES_PER_CLASS; i++) episodes.push(buildEpisode(nodeId, spec.id));
 for (let i = episodes.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [episodes[i], episodes[j]] = [episodes[j], episodes[i]]; }
 // Split by episode, never by sample: neighbouring windows overlap and would leak across the split.
 const cut = Math.floor(episodes.length * .75);
 const testEpisodes = episodes.slice(cut);
 let train = extractRows(nodeId, episodes.slice(0, cut));
 const test = extractRows(nodeId, testEpisodes);
 if (train.length > MAX_ROWS) { const stride = Math.ceil(train.length / MAX_ROWS); train = train.filter((_, i) => i % stride === 0); }

 const f = train[0].values.length;
 const mean = new Array(f).fill(0), scale = new Array(f).fill(0);
 for (const row of train) for (let j = 0; j < f; j++) mean[j] += row.values[j] / train.length;
 for (const row of train) for (let j = 0; j < f; j++) scale[j] += Math.pow(row.values[j] - mean[j], 2) / train.length;
 for (let j = 0; j < f; j++) scale[j] = Math.sqrt(scale[j]) || 1;
 const standardise = (values: number[]) => values.map((v, j) => (v - mean[j]) / scale[j]);

 const head = trainSoftmax(train.map(r => standardise(r.values)), train.map(r => r.klass), specs.length);
 const escalationTrain = train.filter(r => r.escalation != null);
 const escalationHead = trainLogistic(escalationTrain.map(r => standardise(r.values)), escalationTrain.map(r => r.escalation as number));
 // Operating point is chosen on the training split only, so the held-out metrics below stay honest.
 const threshold = bestThreshold(escalationTrain.map(r => sigmoid(dot(escalationHead.w, standardise(r.values)) + escalationHead.b)), escalationTrain.map(r => r.escalation as number));

 const predicted = test.map(r => { const p = softmax(head.w.map((row, c) => dot(row, standardise(r.values)) + head.b[c])); return p.indexOf(Math.max(...p)); });
 const perClass: ClassMetric[] = specs.map((spec, c) => {
  let tp = 0, fp = 0, fn = 0, support = 0;
  test.forEach((row, i) => {
   if (row.klass === c) support++;
   if (predicted[i] === c && row.klass === c) tp++; else if (predicted[i] === c) fp++; else if (row.klass === c) fn++;
  });
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  return { id: spec.id, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, support };
 });
 const accuracy = test.filter((row, i) => predicted[i] === row.klass).length / test.length;

 const escalationTest = test.filter(r => r.escalation != null);
 const escalationScores = escalationTest.map(r => sigmoid(dot(escalationHead.w, standardise(r.values)) + escalationHead.b));
 const escalationLabels = escalationTest.map(r => r.escalation as number);
 let tp = 0, fp = 0, fn = 0;
 escalationScores.forEach((s, i) => { const hit = s >= threshold; if (hit && escalationLabels[i] === 1) tp++; else if (hit) fp++; else if (escalationLabels[i] === 1) fn++; });
 const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;

 // Lead time: in each held-out episode, how long before the rules reach Warning does the head first cross the threshold?
 const leads: number[] = [];
 for (const episode of testEpisodes) {
  const history = episode.steps.map((s, i) => ({ time: i * TICK * 1000, sensors: s.sensors }));
  const warnAt = episode.steps.map(s => ruleRank(nodeId, s.sensors)).findIndex(r => r >= 2);
  if (warnAt < MIN_SAMPLES) continue;
  for (let i = MIN_SAMPLES; i < warnAt; i++) {
   const features = featurize(nodeId, history.slice(0, i + 1));
   if (!features) continue;
   if (sigmoid(dot(escalationHead.w, standardise(features.values)) + escalationHead.b) >= threshold) { leads.push((warnAt - i) * TICK); break; }
  }
 }
 leads.sort((a, b) => a - b);

 const round = (v: number) => Math.round(v * 1e6) / 1e6;
 return {
  classes: specs, features: featureSpec[nodeId].map(s => s.id),
  mean: mean.map(round), scale: scale.map(round),
  weights: head.w.map(row => row.map(round)), bias: head.b.map(round),
  escalation: { weights: escalationHead.w.map(round), bias: round(escalationHead.b), horizonSeconds: HORIZON, alertThreshold: threshold },
  metrics: {
   trainSamples: train.length, testSamples: test.length, accuracy: round(accuracy),
   macroF1: round(perClass.reduce((a, c) => a + c.f1, 0) / perClass.length),
   perClass: perClass.map(c => ({ ...c, precision: round(c.precision), recall: round(c.recall), f1: round(c.f1) })),
   escalation: {
    precision: round(precision), recall: round(recall),
    f1: round(precision + recall ? 2 * precision * recall / (precision + recall) : 0),
    auc: round(auc(escalationScores, escalationLabels)),
    medianLeadSeconds: leads.length ? round(leads[Math.floor(leads.length / 2)]) : 0,
    positives: escalationLabels.reduce((a, c) => a + c, 0)
   }
  }
 };
}

const models = { 'node-1': buildNodeModel('node-1'), 'node-2': buildNodeModel('node-2') };
const bundle: ModelBundle = {
 version: 'sentinel-ml-1.0',
 algorithm: 'Standardised softmax regression (state) + logistic regression (30 s early warning), Adam, L2 2e-4',
 trainedAt: new Date().toISOString(), window: WINDOW, tickSeconds: TICK,
 dataset: {
  episodes: (classes['node-1'].length + classes['node-2'].length) * EPISODES_PER_CLASS,
  samples: models['node-1'].metrics.trainSamples + models['node-1'].metrics.testSamples + models['node-2'].metrics.trainSamples + models['node-2'].metrics.testSamples,
  generator: 'scripts/train-model.ts - seeded synthetic episodes with noise, calibration offsets, dropout and nuisance events',
  seed: SEED
 },
 models
};

const banner = '/** GENERATED BY scripts/train-model.ts - DO NOT EDIT BY HAND. Run `npm run train` to rebuild.\n * Trained on seeded synthetic episodes, so the metrics below are held-out synthetic metrics.\n * They are not evidence of real-world disaster detection skill.\n */';
const target = join(process.cwd(), 'src/lib/ml/model.ts');
writeFileSync(target, `import { ModelBundle } from './schema';\n${banner}\nexport const model: ModelBundle = ${JSON.stringify(bundle, null, 1)};\n`, 'utf8');

for (const nodeId of ['node-1', 'node-2'] as ModelId[]) {
 const m = bundle.models[nodeId];
 console.info(`\n${nodeId}  accuracy ${(m.metrics.accuracy * 100).toFixed(1)}%  macro F1 ${m.metrics.macroF1.toFixed(3)}  (${m.metrics.trainSamples} train / ${m.metrics.testSamples} held-out windows)`);
 for (const c of m.metrics.perClass) console.info(`  ${c.id.padEnd(13)} precision ${(c.precision * 100).toFixed(1).padStart(5)}%  recall ${(c.recall * 100).toFixed(1).padStart(5)}%  support ${c.support}`);
 const e = m.metrics.escalation;
 console.info(`  early warning  precision ${(e.precision * 100).toFixed(1)}%  recall ${(e.recall * 100).toFixed(1)}%  AUC ${e.auc.toFixed(3)}  median lead ${e.medianLeadSeconds}s`);
}
console.info(`\nWrote ${target}`);
