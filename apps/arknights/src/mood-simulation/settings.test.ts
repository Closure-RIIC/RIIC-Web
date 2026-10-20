import assert from "node:assert/strict";
import test from "node:test";
import { pruneSettings, readSettings } from "./settings.ts";
import { defaultMoodSettings } from "./types.ts";
test("saved simulation preferences restore only for the associated schedule", () => {
  const settings={...defaultMoodSettings(),cycles:3,idle:{"1:0:阿米娅":{enabled:false}}};
  const raw=JSON.stringify({signature:"one",settings});
  assert.deepEqual(readSettings(raw,"one"),settings);
  assert.deepEqual(readSettings(raw,"another"),defaultMoodSettings());
  assert.deepEqual(readSettings("{broken","one"),defaultMoodSettings());
  assert.deepEqual(readSettings(JSON.stringify({signature:"one",settings:{...settings,cycles:100}}),"one"),defaultMoodSettings());
});
test("removed shifts/operators/dorms cannot retain hidden simulation overrides", () => {
  const settings={...defaultMoodSettings(),cycles:3,
    fiammetta:{0:{enabled:true,mode:"specified" as const,wait:true},4:{enabled:false,mode:"auto" as const,wait:false}},
    idle:{"0:0:阿米娅":{enabled:true,dorm:"deleted"},"0:0:锡兰":{enabled:false},"2:4:阿米娅":{enabled:false}}};
  const next=pruneSettings(settings,2,new Set(["阿米娅"]),new Set(["dorm_1"]));
  assert.deepEqual(Object.keys(next.fiammetta),["0"]);
  assert.deepEqual(next.idle,{"0:0:阿米娅":{enabled:true}});
  assert.equal(settings.idle["0:0:阿米娅"].dorm,"deleted","pruning must not mutate saved state");
});
