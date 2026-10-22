import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertDiagnosticRoot, diagnosticCategory, diagnosticSummary, makeDiagnostic, persistDiagnostic, readDiagnostics, summarizeDiagnostics } from "./request-diagnostics.ts";
import { failureResponse, PublicApiError } from "./api-contract.ts";

const input={code:"AIC-DATA-8003",status:422,route:"/api/workspace",requestId:"request-1",durationMs:12};

test("diagnostics reject the public directory itself as well as descendants and broad roots",()=>{
  const cwd=path.resolve("fixture-app"); const home=path.resolve("fixture-home");
  for(const root of [cwd,path.join(cwd,"public"),path.join(cwd,"public","logs"),path.parse(cwd).root]) {
    assert.throws(()=>assertDiagnosticRoot(root,cwd,home));
  }
  assert.doesNotThrow(()=>assertDiagnosticRoot(path.resolve("fixture-private"),cwd,home));
});

test("an explicitly configured service HOME may hold the dedicated append-only log directory",()=>{
  const cwd=path.resolve("fixture-app"); const serviceHome=path.resolve("fixture-service-state");
  assert.doesNotThrow(()=>assertDiagnosticRoot(serviceHome,cwd,serviceHome));
  assert.throws(()=>assertDiagnosticRoot(path.dirname(serviceHome),cwd,serviceHome));
});

test("API response keeps its contract while internal logs retain sanitized context",async context=>{
  const logs:unknown[]=[];
  context.mock.method(console,"error",(value:string)=>logs.push(JSON.parse(value)));
  const response=failureResponse(new PublicApiError("AIC-SYS-5000",{cause:new TypeError("Invalid character in header content [\"Link\"]")}),
    "request-test","/api/workspace",performance.now(),"AIC-SYS-5000",new Request("https://test.invalid/api/workspace",{method:"PUT"}));
  assert.equal(response.status,500);
  const body=await response.json(); assert.equal(body.error.code,"AIC-SYS-5000");
  assert.doesNotMatch(JSON.stringify(body),/TypeError|header content/);
  assert.match(JSON.stringify(logs),/TypeError|header content/); assert.match(JSON.stringify(logs),/"method":"PUT"/);
});

test("expected rejections are classified separately from real faults and solver errors",()=>{
  assert.equal(diagnosticCategory("AIC-DATA-8001",403),"consent");
  assert.equal(diagnosticCategory("AIC-DATA-8003",422),"validation");
  assert.equal(diagnosticCategory("AIC-PLAN-3006",429),"rate_limit");
  assert.equal(diagnosticCategory("AIC-AUTH-2008",401),"authentication");
  assert.equal(diagnosticCategory("AIC-PLAN-3004",502),"solver");
  assert.equal(diagnosticCategory("AIC-SYS-5000",500),"fault");
});

test("diagnostics preserve nested causes and field paths without request bodies or secrets",()=>{
  const root=new Error("cred=VERYPRIVATE token=SECRETTOKEN password=pwd email=user@example.com https://host/path?token=BAD");
  const outer=new Error("wrapper",{cause:root});
  root.cause=outer;
  const record=makeDiagnostic({...input,error:outer,request:new Request("https://example.com/api/workspace",{method:"PUT",headers:{"X-RIIC-Client-Version":"build-123","X-RIIC-Client-Schema":"2"},body:"private box"}),fields:[{path:"state.layout",code:"invalid_layout",message:"layout invalid"}]});
  assert.equal(record.causes.length,2); assert.equal(record.method,"PUT"); assert.equal(record.clientVersion,"build-123");
  assert.equal(record.fields[0].path,"state.layout");
  assert.doesNotMatch(JSON.stringify(record),/VERYPRIVATE|SECRETTOKEN|pwd|user@example|BAD|private box/);
  assert.equal(diagnosticSummary("Failed query: select * from users where secret=$1 params: PRIVATE"),"database_query_failed");
});

test("aggregation counts all occurrences and retains individual original records",()=>{
  const from=new Date("2026-09-06T10:00:00Z");const to=new Date("2026-09-06T12:00:00Z");
  const rows=[makeDiagnostic(input,new Date("2026-09-06T11:00:00Z")),makeDiagnostic({...input,requestId:"request-2"},new Date("2026-09-06T11:30:00Z"))];
  const report=summarizeDiagnostics(rows,from,to);
  assert.equal(report.total,2);assert.equal(report.groups.length,1);assert.equal(report.groups[0].count,2);assert.equal(report.recent.length,2);
});

test("resource identifiers do not split endpoint groups or enter durable route labels",()=>{
  const first=makeDiagnostic({...input,route:"/api/tasks/private-task-a?token=secret"});
  const second=makeDiagnostic({...input,route:"/api/tasks/private-task-b"});
  assert.equal(first.route,"/api/tasks/[id]"); assert.equal(first.fingerprint,second.fingerprint);
  assert.doesNotMatch(JSON.stringify(first),/private-task|secret/);
});

test("solver artifact reasons remain specific even when the public error is generic",()=>{
  const record=makeDiagnostic({...input,code:"AIC-PLAN-3004",status:502,
    error:new PublicApiError("AIC-PLAN-3004"),reason:"assignment room trade_2 exceeds capacity 2 token=PRIVATE"});
  assert.match(record.reason,/assignment room trade_2 exceeds capacity 2/);
  assert.doesNotMatch(record.reason,/PRIVATE/);
});

test("append-only diagnostic storage survives repeated reads and UTC midnight",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"riic-diagnostics-"));
  const previous=process.env.BETA_STORAGE_DIR;
  process.env.BETA_STORAGE_DIR=root;
  try {
    const before=makeDiagnostic(input,new Date("2026-09-05T23:59:00Z"));
    const after=makeDiagnostic({...input,requestId:"request-2"},new Date("2026-09-06T00:01:00Z"));
    persistDiagnostic(before);persistDiagnostic(after);
    const file=path.join(root,"diagnostic-logs","2026-09-05.ndjson");
    const original=await readFile(file,"utf8");
    for(let i=0;i<2;i++) assert.equal((await readDiagnostics(1,new Date("2026-09-06T00:30:00Z"))).total,2);
    assert.equal(await readFile(file,"utf8"),original);
  } finally {
    if(previous===undefined)delete process.env.BETA_STORAGE_DIR;else process.env.BETA_STORAGE_DIR=previous;
    await rm(root,{recursive:true,force:true});
  }
});
