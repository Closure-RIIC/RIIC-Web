import nextEnv from "@next/env";
async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const { maintainAgentGateway, recordGatewayMaintenanceFailure } = await import("../src/server/agent/gateway-maintenance.ts");
  const { getDatabasePool } = await import("../src/server/db/index.ts");
  const { recoverAgentRuns } = await import("../src/server/billing/agent-accounting.ts");
  let stopped = false;
  process.once("SIGTERM", () => { stopped = true; }); process.once("SIGINT", () => { stopped = true; });
  while (!stopped) {
    try { const result = await maintainAgentGateway(); if (result.imported || result.recovered) console.log(JSON.stringify({event:"agent_maintenance",...result})); }
    catch { console.error(JSON.stringify({event:"agent_maintenance_failed"})); await recordGatewayMaintenanceFailure().catch(()=>{}); await recoverAgentRuns().catch(()=>{}); }
    for (let i=0;i<30&&!stopped;i++) await new Promise(resolve=>setTimeout(resolve,1000));
  }
  await getDatabasePool().end();
}
void main().catch(()=>{console.error("Agent worker failed to start");process.exitCode=1;});
