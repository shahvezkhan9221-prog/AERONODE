const assert = require('node:assert/strict');
const path = require('node:path');
const build = process.env.ML_BUILD || path.join(__dirname, '..', '.tmp/test');
const { predict } = require(path.join(build, 'ml/index.js'));
const { fuse } = require(path.join(build, 'fusion.js'));
const { tierRank } = require(path.join(build, 'types.js'));

let checks = 0;
function check(value, expected, label) { assert.deepEqual(value, expected, label); checks++; }
function assertTrue(value, label) { assert.equal(value, true, label); checks++; }

const TICK = 1500;
/** Builds a history window from a per-sample reading factory. No randomness: these assertions must be stable. */
const window = (n, build) => Array.from({ length: n }, (_, i) => ({ time: i * TICK, sensors: build(i) }));
const worstTier = (nodeId, sensors) => fuse(nodeId, sensors).reduce((worst, h) => tierRank[h.tier] > tierRank[worst] ? h.tier : worst, 'Normal');
const run = (nodeId, history) => predict(nodeId, history, worstTier(nodeId, history[history.length - 1].sensors));

// --- abstention: the model reports nothing rather than guessing --------------------------------
check(predict('node-1', window(3, () => ({ acceleration: .02, shock: 0, sound: 0 })), 'Normal'), null, 'too few samples returns null');
check(predict('node-1', window(20, () => ({ acceleration: null, shock: null, sound: null })), 'Normal'), null, 'all-null window returns null');
check(predict('node-1', [], 'Normal'), null, 'empty history returns null');
check(predict('node-3', window(20, () => ({ acceleration: .02 })), 'Normal'), null, 'unknown node is not modelled');

// --- PIR stays out of the model, exactly as it stays out of the rules ---------------------------
const hydro = i => ({ moisture: 40 + i * .1, rain: 8, float: 0 });
check(
 run('node-2', window(20, i => ({ ...hydro(i), pir: 0 }))),
 run('node-2', window(20, i => ({ ...hydro(i), pir: 1 }))),
 'PIR invariance: presence never changes a prediction'
);
check(
 run('node-2', window(20, i => ({ ...hydro(i), pir: i % 2 }))).state,
 run('node-2', window(20, i => ({ ...hydro(i), pir: null }))).state,
 'PIR invariance under alternating and missing presence'
);

// --- determinism ------------------------------------------------------------------------------
const repeatable = window(20, i => ({ acceleration: .02 + i * .001, shock: 0, sound: 0 }));
check(run('node-1', repeatable), run('node-1', repeatable), 'identical input gives identical output');

// --- baselines ---------------------------------------------------------------------------------
const seismicBaseline = run('node-1', window(20, () => ({ acceleration: .022, shock: 0, sound: 0 })));
check(seismicBaseline.state, 'baseline', 'quiet node 1 reads as baseline');
check(seismicBaseline.hazard, false, 'baseline is not a hazard state');
const hydroBaseline = run('node-2', window(20, () => ({ moisture: 38, rain: 7, float: 0, pir: 0 })));
check(hydroBaseline.state, 'baseline', 'settled node 2 reads as baseline');

// --- real onsets are recognised ------------------------------------------------------------------
const quake = run('node-1', window(20, i => { const envelope = Math.max(0, (i - 4) / 15) * .9; return { acceleration: .022 + envelope, shock: envelope >= .12 ? 1 : 0, sound: envelope >= .28 ? 1 : 0 }; }));
check(quake.state, 'seismic', 'a sustained corroborated envelope reads as seismic');
check(quake.hazard, true, 'seismic is a hazard state');

const flood = run('node-2', window(20, i => ({ moisture: 40 + i * 2.4, rain: 10 + i * 4.2, float: i >= 9 ? 1 : 0, pir: 0 })));
check(flood.state, 'flood', 'rising water with rain and saturation reads as flooding');


// --- nuisance rejection: the point of adding the model to the rule engine -------------------------
// Chosen so both comparators are tripped on the final sample: the rules are at Warning at the very
// instant the model is asked, which is what makes the disagreement meaningful.
const machinerySensors = i => ({ acceleration: .05, shock: i % 3 === 1 ? 1 : 0, sound: i % 4 === 3 ? 1 : 0 });
const machinery = run('node-1', window(20, machinerySensors));
assertTrue(tierRank[worstTier('node-1', machinerySensors(19))] >= 2, 'the rules do escalate on repeated comparator trips');
check(machinery.state, 'machinery', 'repeated trips with low peak acceleration read as machinery, not an earthquake');
check(machinery.hazard, false, 'machinery is not a hazard state');
check(machinery.agreement, 'model-calm', 'the model disagrees with the rule escalation and says so');

const disturbance = run('node-1', window(20, i => ({ acceleration: i === 16 ? 1.1 : .022, shock: i === 16 ? 1 : 0, sound: i === 16 ? 1 : 0 })));
assertTrue(disturbance.state !== 'seismic', 'a single isolated spike is not called seismic');

const irrigation = run('node-2', window(20, i => ({ moisture: 40 + i * 2.6, rain: 7, float: 0, pir: 0 })));
check(irrigation.state, 'irrigation', 'soil wetting with a dry rain pad reads as local wetting');
check(irrigation.hazard, false, 'local wetting is not a hazard state');

const stuckFloat = run('node-2', window(20, () => ({ moisture: 37, rain: 6, float: 1, pir: 0 })));
check(stuckFloat.state, 'float_fault', 'a high float over dry soil and a dry pad reads as a float fault');

// --- probabilities and drivers are well formed ----------------------------------------------------
for (const insight of [seismicBaseline, quake, flood, machinery, irrigation, stuckFloat]) {
 assertTrue(Math.abs(insight.classes.reduce((sum, c) => sum + c.probability, 0) - 100) < 1.5, 'class probabilities sum to 100');
 assertTrue(insight.confidence > 0 && insight.confidence <= 100, 'confidence is a percentage');
 check(insight.classes[0].id, insight.state, 'the leading class is the reported state');
 assertTrue(insight.drivers.length > 0 && insight.drivers.every(d => Number.isFinite(d.effect) && d.label.length > 0), 'drivers are labelled and finite');
 assertTrue(['aligned', 'model-ahead', 'model-calm'].includes(insight.agreement), 'agreement is one of the three defined values');
}

// --- the early-warning head is only offered where the trained metrics support it ---------------------
check(quake.forecast.supported, false, 'node 1 offers no forecast: a co-located node has no lead time on ground motion');
check(flood.forecast.supported, true, 'node 2 offers a forecast');
check(flood.forecast.status, 'already-warning', 'no forecast is shown once the rules already warn');
check(flood.forecast.alert, false, 'an already-warning node never raises a forecast alert');

// A flood that has not yet corroborated: the rules are still below Warning, so a forecast is live.
const early = window(20, i => ({ moisture: 42 + i * 1.9, rain: 9 + i * 1.6, float: 0, pir: 0 }));
const earlyTier = worstTier('node-2', early[early.length - 1].sensors);
assertTrue(tierRank[earlyTier] < 2, 'the rule engine has not reached Warning yet');
const earlyInsight = run('node-2', early);
check(earlyInsight.forecast.status, 'forecast', 'a live forecast is offered below Warning');
assertTrue(earlyInsight.forecast.alert, 'the model flags the approaching threshold crossing before the rules do');
check(earlyInsight.agreement, 'model-ahead', 'running ahead of the rules is reported as such');

// --- the model is advisory: it cannot touch a tier ----------------------------------------------------
for (const [nodeId, sensors] of [['node-1', { acceleration: .05, shock: 1, sound: 1 }], ['node-2', { moisture: 90, rain: 80, float: 1, pir: 1 }]]) {
 const before = JSON.stringify(fuse(nodeId, sensors));
 run(nodeId, window(20, () => sensors));
 check(JSON.stringify(fuse(nodeId, sensors)), before, `${nodeId} rule output is unchanged by inference`);
}

console.info(`PASS: ${checks} model assertions. Nuisance events rejected, PIR excluded, forecasts gated on held-out skill, rules untouched.`);
