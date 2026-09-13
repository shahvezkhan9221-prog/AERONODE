import { MlClassScore, MlDriver, MlInsight, Tier, tierRank } from '../types';
import { ModelId, Sample, WINDOW, featureSpec, featurize, formatFeature } from './features';
import { model } from './model';
/** Serving side of the advisory model trained by scripts/train-model.ts.
 *
 * The model is a second opinion, never an authority. fusion.ts still decides every tier and every
 * event written to history; nothing here can raise, lower or suppress a rule-based alert. What the
 * model adds is the two things an instantaneous threshold cannot express:
 *   - a named physical state, including nuisance states (machinery, irrigation, a jammed float),
 *     so an operator can see WHY the rules are about to fire, or why they fired on nothing;
 *   - a probability that the rules will reach Warning within the next horizon, for lead time.
 *
 * Inference is a standardise + dot product per class: no runtime dependency, no network call,
 * and a few microseconds per node, so it runs inside the same 1.5 s monitor tick as fusion.
 */
export { model } from './model';
export { WINDOW, featureSpec } from './features';

/** Below this held-out AUC the early-warning head is not shown as a forecast. A single co-located
 * vibration node has no physical lead time on ground motion, and the trained metrics say so. */
const RELIABLE_AUC = .75;
/** Confidence needed before a model-only hazard call is surfaced as running ahead of the rules. */
const AHEAD_CONFIDENCE = 55;

export function isModelled(nodeId: string): nodeId is ModelId { return nodeId === 'node-1' || nodeId === 'node-2'; }

const dot = (w: number[], x: number[]) => { let s = 0; for (let i = 0; i < w.length; i++) s += w[i] * x[i]; return s; };
const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));
function softmax(z: number[]) { const m = Math.max(...z); const e = z.map(v => Math.exp(v - m)); const sum = e.reduce((a, b) => a + b, 0); return e.map(v => v / sum); }

/** Returns null when the node has too little recent data to model, which is a real state, not an error. */
export function predict(nodeId: string, history: Sample[], ruleTier: Tier): MlInsight | null {
 if (!isModelled(nodeId)) return null;
 const extracted = featurize(nodeId, history);
 if (!extracted) return null;
 const node = model.models[nodeId];
 const standardised = extracted.values.map((v, j) => (v - node.mean[j]) / (node.scale[j] || 1));
 const probabilities = softmax(node.weights.map((row, c) => dot(row, standardised) + node.bias[c]));
 const top = probabilities.indexOf(Math.max(...probabilities));
 const winner = node.classes[top];
 const classes: MlClassScore[] = node.classes.map((c, i) => ({ id: c.id, label: c.label, hazard: c.hazard, probability: Math.round(probabilities[i] * 1000) / 10 })).sort((a, b) => b.probability - a.probability);

 // Contribution of each feature to the winning class, measured against the average class weight:
 // this is the exact decomposition of the softmax logit, not a post-hoc approximation.
 const specs = featureSpec[nodeId];
 const averageWeight = specs.map((_, j) => node.weights.reduce((sum, row) => sum + row[j], 0) / node.weights.length);
 const drivers: MlDriver[] = specs
  .map((spec, j) => ({ feature: spec.id, label: spec.label, value: formatFeature(spec.format, extracted.values[j]), effect: Math.round((node.weights[top][j] - averageWeight[j]) * standardised[j] * 1000) / 1000 }))
  .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
  .slice(0, 4);

 const rank = tierRank[ruleTier];
 const supported = node.metrics.escalation.auc >= RELIABLE_AUC;
 const probability = Math.round(sigmoid(dot(node.escalation.weights, standardised) + node.escalation.bias) * 1000) / 10;
 const status = !supported ? 'unsupported' : rank >= 2 ? 'already-warning' : 'forecast';
 const alert = status === 'forecast' && probability >= node.escalation.alertThreshold * 100;
 const forecast = { supported, status, probability, alert, horizonSeconds: node.escalation.horizonSeconds, note:
  status === 'unsupported' ? `No usable lead time: a single co-located vibration node cannot see ground motion before it arrives (held-out AUC ${node.metrics.escalation.auc.toFixed(2)}). The model is used here to tell a real onset from machinery and handling.`
  : status === 'already-warning' ? 'The rule engine has already reached Warning. A forecast adds nothing once the thresholds are met.'
  : alert ? `The model expects the rule thresholds to be met within ${node.escalation.horizonSeconds} s.`
  : `No rule threshold crossing expected within ${node.escalation.horizonSeconds} s.` } as const;

 const confidence = Math.round(probabilities[top] * 1000) / 10;
 const agreement = winner.hazard && confidence >= AHEAD_CONFIDENCE && rank < 2 ? 'model-ahead' : !winner.hazard && rank >= 2 ? 'model-calm' : 'aligned';
 return {
  version: model.version, state: winner.id, label: winner.label, hazard: winner.hazard, confidence,
  description: winner.description, classes, drivers, forecast, agreement,
  samples: extracted.samples, window: WINDOW
 };
}

/** Human-readable summary of how the model differs from the rules right now. */
export function agreementNote(insight: MlInsight, ruleTier: Tier): string {
 if (insight.agreement === 'model-ahead') return `The model reads this window as ${insight.label.toLowerCase()} while the rules are still at ${ruleTier}. Treat it as an early look, not an alert.`;
 if (insight.agreement === 'model-calm') return `The rules are at ${ruleTier}, but the model reads this pattern as ${insight.label.toLowerCase()}. Check the evidence before escalating.`;
 return `The model and the rule engine agree on this window.`;
}
