import assert from "node:assert/strict";
import test from "node:test";
import { createTelemetryQueue, retryAfterMs } from "./telemetry-queue.ts";

function fixture(send: (events:number[])=>Promise<{status:number;retryAfter:string|null}>) {
  let now=0;
  let shared=0;
  let nextId=0;
  const timers=new Map<number,{at:number;callback:()=>void}>();
  const beacons:number[][]=[];
  const queue=createTelemetryQueue<number>({send,now:()=>now,
    schedule:(callback,delay)=>{ const id=++nextId; timers.set(id,{at:now+delay,callback}); return id as unknown as ReturnType<typeof setTimeout>; },
    cancel:id=>{timers.delete(id as unknown as number);},
    readCooldown:()=>shared,writeCooldown:value=>{shared=value;},
    beacon:events=>{beacons.push(events); return true;},
  });
  return {queue,beacons,timers,setNow:(value:number)=>{now=value;},setShared:(value:number)=>{shared=value;},getShared:()=>shared};
}

test("normal telemetry is batched rather than beaconed or immediately burst at the threshold",async()=>{
  const batches:number[][]=[];
  const f=fixture(async batch=>{batches.push(batch);return {status:200,retryAfter:null};});
  for(let i=0;i<60;i++) f.queue.enqueue(i);
  assert.equal(batches.length,0); assert.equal(f.timers.size,1);
  await f.queue.flush();
  assert.equal(batches[0].length,20); assert.equal(f.queue.inspect().pending,40);
  assert.equal(f.beacons.length,0);
});

test("429 retains a batch, shares cooldown and prevents explicit/unload bypass",async()=>{
  let calls=0;
  const f=fixture(async()=>{calls++;return {status:429,retryAfter:"30"};});
  f.queue.enqueue(1); await f.queue.flush();
  assert.equal(f.getShared(),30_000); assert.equal(f.queue.inspect().pending,1);
  await f.queue.flush(); f.queue.hide(); assert.equal(calls,1); assert.equal(f.beacons.length,0);
  f.setNow(30_000); await f.queue.flush(); assert.equal(calls,2);
});

test("in-flight flush is serialized; new events survive slow responses",async()=>{
  let finish!:(value:{status:number;retryAfter:null})=>void;
  let calls=0;
  const f=fixture(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  f.queue.enqueue(1); const task=f.queue.flush(); f.queue.enqueue(2);
  await f.queue.flush(); f.queue.hide(); assert.equal(calls,1); assert.equal(f.beacons.length,0);
  finish({status:200,retryAfter:null}); await task;
  assert.equal(f.queue.inspect().pending,1); assert.equal(f.timers.size,1);
});

test("malformed telemetry is not retried; retryable failures and memory are bounded",async()=>{
  const bad=fixture(async()=>({status:400,retryAfter:null}));
  bad.queue.enqueue(1); await bad.queue.flush(); assert.equal(bad.queue.inspect().pending,0);
  const f=fixture(async()=>{throw new Error("offline");});
  f.queue.enqueue(1);
  for(const at of [0,10_000,30_000]) {f.setNow(at);await f.queue.flush();}
  assert.equal(f.queue.inspect().pending,0); assert.equal(f.queue.inspect().dropped,1);
  for(let i=0;i<1000;i++)f.queue.enqueue(i);
  assert.equal(f.queue.inspect().pending,100);
  assert.equal(f.queue.inspect().dropped,901);
});

test("other tabs cooldown is honored and disposal ignores late results",async()=>{
  const f=fixture(async()=>({status:200,retryAfter:null})); f.queue.enqueue(1); f.setShared(50_000);
  await f.queue.flush(); assert.equal(f.queue.inspect().pending,1);
  f.queue.dispose(); assert.equal(f.timers.size,0); f.queue.enqueue(2); assert.equal(f.queue.inspect().pending,0);
});

test("Retry-After supports seconds and HTTP dates with a finite cap",()=>{
  assert.equal(retryAfterMs("30",0),30_000);
  assert.equal(retryAfterMs("Thu, 01 Jan 1970 00:01:00 GMT",0),60_000);
  assert.equal(retryAfterMs("bad",0),0); assert.equal(retryAfterMs("99999999",0),3_600_000);
});
