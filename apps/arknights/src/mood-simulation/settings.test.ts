import assert from "node:assert/strict";
import test from "node:test";
import { pruneSettings, readSettings, resolveFiammettaRule } from "./settings.ts";
import { defaultMoodSettings } from "./types.ts";
test("saved simulation preferences restore only for the associated schedule", () => {
  const settings={...defaultMoodSettings(),cycles:3,idle:{"1:0:阿米娅":{enabled:false}}};
  const raw=JSON.stringify({signature:"one",settings});
  assert.deepEqual(readSettings(raw,"one"),settings);
  assert.deepEqual(readSettings(raw,"another"),defaultMoodSettings());
  assert.deepEqual(readSettings("{broken","one"),defaultMoodSettings());
  assert.deepEqual(readSettings(JSON.stringify({signature:"one",settings:{...settings,cycles:100}}),"one"),defaultMoodSettings());
});
test("removed shifts and operators cannot retain hidden simulation overrides", () => {
  const settings={...defaultMoodSettings(),cycles:3,
    fiammetta:{0:{enabled:true,mode:"specified" as const},4:{enabled:false,mode:"auto" as const}},
    idle:{"0:0:阿米娅":{enabled:true},"0:0:锡兰":{enabled:false},"2:4:阿米娅":{enabled:false}}};
  const next=pruneSettings(settings,2,new Set(["阿米娅"]));
  assert.deepEqual(Object.keys(next.fiammetta),["0"]);
  assert.deepEqual(next.idle,{"0:0:阿米娅":{enabled:true}});
  assert.equal(Object.keys(settings.idle).length,3,"pruning must not mutate saved state");
});

test("legacy waiting and replacement options migrate without losing enabled switches", () => {
  const settings = {...defaultMoodSettings(), fiammetta:{0:{enabled:true,mode:"auto",wait:false}}, idle:{"0:1:芬":{enabled:false,target:"杜林",dorm:"dorm_2"}}};
  const restored = readSettings(JSON.stringify({signature:"one", settings}),"one");
  assert.deepEqual(restored.fiammetta[0], {enabled:true,mode:"auto"});
  assert.deepEqual(restored.idle["0:1:芬"], {enabled:false});
});

test("Fiammetta mode preferences keep default and explicit switches distinct after reload", () => {
  const settings = {...defaultMoodSettings(), fiammetta:{
    0:{mode:"specified" as const, enabled:false},
    1:{mode:"auto" as const},
    2:{mode:"previous" as const, enabled:true},
  }};
  const restored = readSettings(JSON.stringify({signature:"one", settings}), "one");
  assert.deepEqual(restored, settings);
  assert.equal(resolveFiammettaRule(restored.fiammetta[0], "芬").enabled, false);
  assert.equal(resolveFiammettaRule(restored.fiammetta[1], null).enabled, false);
  assert.equal(resolveFiammettaRule(restored.fiammetta[2], null).enabled, true);
  assert.equal(resolveFiammettaRule(undefined, "芬").enabled, true);
});
