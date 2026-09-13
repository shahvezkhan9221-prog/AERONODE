const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const build = [process.env.FUSION_BUILD, path.join(__dirname, '..', '.tmp/test/fusion.js'), '/tmp/sentinel-fusion-tests/fusion.js'].find(p => p && fs.existsSync(p));
const { fuse } = require(build);
const danger = h => ['Warning', 'Critical'].includes(h.tier);
let checks = 0;
function check(value, expected, label) { assert.deepEqual(value, expected, label); checks++; }
check(fuse('node-1',{acceleration:.02,shock:0,sound:0})[0].tier,'Normal','seismic baseline');
check(fuse('node-1',{acceleration:.2,shock:0,sound:0})[0].tier,'Watch','isolated acceleration');
check(fuse('node-1',{acceleration:.2,shock:1,sound:0})[0].tier,'Warning','two seismic signals');
check(fuse('node-1',{acceleration:.2,shock:1,sound:1})[0].score,78,'three signals below peak');
check(fuse('node-1',{acceleration:.6,shock:1,sound:1})[0].score,92,'critical seismic threshold');
check(fuse('node-2',{float:1,rain:40,moisture:38})[0].tier,'Warning','corroborated flood');
check(fuse('node-2',{float:1,rain:75,moisture:85})[0].tier,'Critical','critical flood');
for (const id of ['node-1','node-2']) {
 for (const [sensor,max] of Object.entries({ acceleration:32,shock:1,sound:1,moisture:100,float:1,rain:100,pir:1 })) {
  check(fuse(id,{[sensor]:max}).some(danger), false, `${id} cannot warn from ${sensor} alone`);
 }
 check(fuse(id,{}).some(danger),false,'missing data cannot warn');
 check(fuse(id,{acceleration:null,shock:null,sound:null,moisture:null,rain:null,float:null,pir:null}).some(danger),false,'null data cannot warn');
}
for (const acceleration of [0,.15,.6,1]) for (const shock of [0,1]) for (const sound of [0,1]) {
 const h = fuse('node-1',{acceleration,shock,sound})[0];
 if (danger(h)) check(h.contributors.length >= 2,true,'seismic independent corroboration');
}
for (const moisture of [0,38,65,85,100]) for (const rain of [0,39,40,75,100]) for (const float of [0,1]) {
 const r = {moisture,rain,float};
 check(fuse('node-2',{...r,pir:0}),fuse('node-2',{...r,pir:1}),'PIR invariance');
 for (const h of fuse('node-2',r)) if (danger(h)) check(h.contributors.length >= 2,true,'node 2 independent corroboration');
}
console.info(`PASS: ${checks} fusion assertions. No single-sensor warning paths; PIR excluded.`);
