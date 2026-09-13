import { ModelId } from './features';
/** Shape of the trained artefact written by scripts/train-model.ts into model.ts.
 * Kept separate from index.ts so the generated file and the trainer can both import
 * the type without a cycle through the inference code.
 */
export interface ClassSpec { id: string; label: string; hazard: boolean; description: string }
export interface ClassMetric { id: string; precision: number; recall: number; f1: number; support: number }
export interface NodeModel {
 classes: ClassSpec[];
 features: string[];
 /** Standardisation statistics from the training split only. */
 mean: number[]; scale: number[];
 /** Softmax head: weights[class][feature] plus per-class bias. */
 weights: number[][]; bias: number[];
 /** Binary head: probability that the rule engine reaches Warning or above within horizonSeconds. */
 escalation: { weights: number[]; bias: number; horizonSeconds: number; alertThreshold: number };
 metrics: {
  trainSamples: number; testSamples: number; accuracy: number; macroF1: number; perClass: ClassMetric[];
  escalation: { precision: number; recall: number; f1: number; auc: number; medianLeadSeconds: number; positives: number };
 };
}
export interface ModelBundle {
 version: string; algorithm: string; trainedAt: string; window: number; tickSeconds: number;
 dataset: { episodes: number; samples: number; generator: string; seed: number };
 models: Record<ModelId, NodeModel>;
}
