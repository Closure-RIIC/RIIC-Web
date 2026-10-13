// Extend the existing release helper's strict worker allowlist and service reconciliation.
// All existing artifact, migration, health, rollback and CI authorization gates remain in place.
import { readFileSync, writeFileSync, copyFileSync, renameSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";
import console from "node:console";
if(process.platform!=="linux"||process.getuid()!==0)throw new Error("Run on the deployment host as root");
const target="/usr/local/sbin/arknights-infra-deploy";
const original=readFileSync(target,"utf8");
if(original.includes("reconcile_agent_billing_worker()")){console.log("Agent worker deployment support is already installed");process.exit(0);}
const functionText=`reconcile_agent_billing_worker() {
  [[ "$test_mode" == "0" ]] || return 0
  local environment=production
  [[ "$app_root" != "/opt/arknights-infra-dev" ]] || environment=development
  local unit="riic-agent-worker-$environment.service"
  if [[ ! -f "$current_link/worker/agent-worker.cjs" ]]; then
    if systemctl cat "$unit" >/dev/null 2>&1; then systemctl stop "$unit"; fi
    return 0
  fi
  systemctl restart "$unit" || return 1
  systemctl is-active --quiet "$unit"
}

`;
let next=original;
const changes=[
  ["! -name plan-worker.cjs ! -name quality-worker.cjs -print", "! -name plan-worker.cjs ! -name quality-worker.cjs ! -name agent-worker.cjs -print"],
  ["may contain only plan-worker.cjs and quality-worker.cjs.","may contain only plan-worker.cjs, quality-worker.cjs and agent-worker.cjs."],
  ["restart_release_services() {",functionText+"restart_release_services() {"],
];
for(const [before,after] of changes){if(next.split(before).length!==2)throw new Error("Release helper changed; inspect it before patching");next=next.replace(before,after);}
const anchor="  reconcile_private_quality_worker || return 1";
if(next.split(anchor).length!==3)throw new Error("Expected deployment and rollback reconciliation points");
next=next.replaceAll(anchor,anchor+"\n  reconcile_agent_billing_worker || return 1");
const temporary=target+".agent-20261012.tmp";
writeFileSync(temporary,next,{mode:0o755});execFileSync("bash",["-n",temporary]);
const backup="/var/backups/riic-agent-rollout-20261012";mkdirSync(backup,{recursive:true,mode:0o700});copyFileSync(target,backup+"/arknights-infra-deploy.before-agent");
renameSync(temporary,target);console.log("Release helper extended; shell syntax verified; prior helper backed up");
