'use client';
import { BrainCircuit, ChartSpline, CircleDot, Info, ShieldAlert, Timer, TrendingUp, Waypoints } from 'lucide-react';
import { MlInsight, NodeData, highestHazard } from '@/lib/types';
import { model } from '@/lib/ml/model';
/** Presentation for the advisory model. Everything here is clearly separated from the rule-based
 * tier so an operator never mistakes a model opinion for a corroborated warning. */

const agreementCopy: Record<MlInsight['agreement'], { label: string; tone: string }> = {
 aligned: { label: 'Agrees with the rules', tone: 'ml-aligned' },
 'model-ahead': { label: 'Model is ahead of the rules', tone: 'ml-ahead' },
 'model-calm': { label: 'Model reads this as benign', tone: 'ml-calm' }
};

export function MlStrip({ node }: { node: NodeData }) {
 if (!node.online || !node.ml) return <div className="ml-strip ml-strip-idle"><BrainCircuit size={15} /><span><strong>Model idle</strong><small>{node.online ? 'Building a 30 s window…' : 'No telemetry to analyse'}</small></span></div>;
 const ml = node.ml;
 return <div className={`ml-strip ${ml.hazard ? 'ml-strip-hazard' : ''}`}>
  <BrainCircuit size={15} />
  <span><strong>{ml.label}</strong><small>{ml.confidence}% model confidence · {ml.samples} samples</small></span>
  {ml.forecast.alert ? <em className="ml-forecast-chip"><TrendingUp size={12} />{ml.forecast.probability}% in {ml.forecast.horizonSeconds}s</em> : <em className={`ml-agree-chip ${agreementCopy[ml.agreement].tone}`}>{ml.agreement === 'aligned' ? 'Aligned' : ml.agreement === 'model-ahead' ? 'Ahead' : 'Benign'}</em>}
 </div>;
}

export function MlPanel({ node, compact = false }: { node: NodeData; compact?: boolean }) {
 const ml = node.ml;
 if (!node.online || !ml) return <div className="ml-empty"><BrainCircuit size={19} /><span><strong>Nothing to analyse yet</strong><small>{node.online ? `The model needs at least 4 valid readings in the last ${model.window} samples.` : 'This node is offline. The model never fills gaps with simulated values.'}</small></span></div>;
 const tier = highestHazard(node).tier;
 const agreement = agreementCopy[ml.agreement];
 return <div className="ml-panel">
  <div className="ml-headline">
   <div className={`ml-verdict ${ml.hazard ? 'hazard' : ''}`}><span className="small-label">MODEL READS THIS AS</span><strong>{ml.label}</strong><small>{ml.confidence}% confidence across a {ml.window}-sample window</small></div>
   <span className={`ml-agree-chip ${agreement.tone}`}><CircleDot size={12} />{agreement.label}</span>
  </div>
  <p className="ml-description">{ml.description}</p>
  <div className="ml-class-list">{ml.classes.filter(c => c.probability >= 1 || c.id === ml.state).map(c => <div key={c.id} className={`ml-class ${c.id === ml.state ? 'leading' : ''}`}>
   <span>{c.label}{c.hazard && <i className="ml-hazard-dot" title="Hazard state" />}</span>
   <div className="ml-class-track"><span style={{ width: `${c.probability}%` }} /></div>
   <strong>{c.probability}%</strong>
  </div>)}</div>
  <div className={`ml-forecast ${ml.forecast.alert ? 'alerting' : ''} ${ml.forecast.supported ? '' : 'unsupported'}`}>
   {ml.forecast.supported ? <Timer size={17} /> : <ShieldAlert size={17} />}
   <div>
    <strong>{ml.forecast.supported ? `Rules reaching Warning within ${ml.forecast.horizonSeconds}s: ${ml.forecast.status === 'already-warning' ? '—' : `${ml.forecast.probability}%`}` : 'No early-warning head for this node'}</strong>
    <small>{ml.forecast.note}</small>
   </div>
  </div>
  {!compact && <><h4 className="ml-subtitle"><Waypoints size={14} /> What moved the prediction</h4>
   <div className="ml-driver-list">{ml.drivers.map(d => <div key={d.feature} className="ml-driver">
    <span><strong>{d.label}</strong><small>{d.value}</small></span>
    <div className="ml-driver-track"><span className={d.effect >= 0 ? 'positive' : 'negative'} style={{ width: `${Math.min(100, Math.abs(d.effect) / Math.max(...ml.drivers.map(x => Math.abs(x.effect)), 1e-6) * 100)}%` }} /></div>
    <em>{d.effect >= 0 ? '+' : ''}{d.effect.toFixed(2)}</em>
   </div>)}</div></>}
  <div className="ml-disclaimer"><Info size={15} /><span>Advisory only. The tier shown on this node is <strong>{tier}</strong> and comes from the documented rules in <code>src/lib/fusion.ts</code>. The model cannot raise, lower or suppress an alert, and it never reads the PIR sensor.</span></div>
 </div>;
}

export function ModelIntro() {
 return <div className="fusion-principle neo ml-principle">
  <div className="login-icon"><BrainCircuit size={28} /></div>
  <div>
   <span className="eyebrow">A SECOND OPINION, NOT A SECOND AUTHORITY</span>
   <h2>The model explains the window. The rules still decide.</h2>
   <p>A threshold reads one instant. The model reads the last {Math.round(model.window * model.tickSeconds)} seconds of every sensor on a node, so it can name what the pattern looks like — including the nuisance events that trip a threshold without meaning anything — and estimate how close the rules are to firing.</p>
  </div>
  <span className="rule-version">{model.version.toUpperCase()}</span>
 </div>;
}

export function ModelCard() {
 const nodes = [{ id: 'node-1' as const, name: 'Node 01 · Seismic' }, { id: 'node-2' as const, name: 'Node 02 · Flood & water level' }];
 return <section className="neo ml-model-card">
  <div className="section-heading"><h2>Model card</h2><span className="muted"><ChartSpline size={14} /> src/lib/ml/model.ts</span></div>
  <div className="ml-meta-grid">
   <div><span className="small-label">VERSION</span><strong>{model.version}</strong></div>
   <div><span className="small-label">ALGORITHM</span><strong>Softmax + logistic regression</strong></div>
   <div><span className="small-label">INPUT WINDOW</span><strong>{model.window} samples · {Math.round(model.window * model.tickSeconds)} s</strong></div>
   <div><span className="small-label">TRAINED</span><strong>{new Date(model.trainedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></div>
   <div><span className="small-label">TRAINING EPISODES</span><strong>{model.dataset.episodes.toLocaleString('en-GB')}</strong></div>
   <div><span className="small-label">LABELLED WINDOWS</span><strong>{model.dataset.samples.toLocaleString('en-GB')}</strong></div>
  </div>
  <div className="ml-warning"><ShieldAlert size={17} /><span><strong>Trained on synthetic telemetry.</strong> No real earthquake or flood recordings were available for this prototype. Episodes are generated by <code>scripts/train-model.ts</code> with noise, calibration offsets, packet dropout and deliberate nuisance events. Every number below is a held-out <em>synthetic</em> score and is not evidence of real-world detection skill.</span></div>
  {nodes.map(n => { const m = model.models[n.id]; return <div key={n.id} className="ml-metrics-block">
   <div className="ml-metrics-heading"><h3>{n.name}</h3><span>{(m.metrics.accuracy * 100).toFixed(1)}% accuracy · macro F1 {m.metrics.macroF1.toFixed(2)} · {m.metrics.testSamples.toLocaleString('en-GB')} held-out windows</span></div>
   <div className="table-scroll"><table className="ml-metrics-table"><thead><tr><th>State</th><th>Precision</th><th>Recall</th><th>F1</th><th>Support</th></tr></thead><tbody>
    {m.metrics.perClass.map(c => { const spec = m.classes.find(s => s.id === c.id); return <tr key={c.id}><td>{spec?.label ?? c.id}{spec?.hazard && <i className="ml-hazard-dot" />}</td><td>{(c.precision * 100).toFixed(1)}%</td><td>{(c.recall * 100).toFixed(1)}%</td><td>{c.f1.toFixed(2)}</td><td>{c.support.toLocaleString('en-GB')}</td></tr>; })}
   </tbody></table></div>
   <div className="ml-escalation-row">
    <span className="small-label">{m.escalation.horizonSeconds}s EARLY WARNING HEAD</span>
    {m.metrics.escalation.auc >= .75
     ? <p>AUC {m.metrics.escalation.auc.toFixed(3)} · precision {(m.metrics.escalation.precision * 100).toFixed(0)}% · recall {(m.metrics.escalation.recall * 100).toFixed(0)}% at a {m.escalation.alertThreshold.toFixed(2)} operating point, giving a median <strong>{m.metrics.escalation.medianLeadSeconds}s</strong> of lead over the rule engine on held-out episodes.</p>
     : <p>AUC {m.metrics.escalation.auc.toFixed(3)} — below the 0.75 bar, so this head is <strong>disabled in the UI</strong>. A single co-located vibration node cannot see ground motion coming; the model earns its place on this node by separating a real onset from machinery and handling instead.</p>}
   </div>
  </div>; })}
  <div className="ml-disclaimer"><Info size={15} /><span>The model is advisory. Tiers, alerts and the event log remain owned by the deterministic rules in <code>src/lib/fusion.ts</code>, so every warning on this dashboard is still explainable without reference to learned weights.</span></div>
 </section>;
}
