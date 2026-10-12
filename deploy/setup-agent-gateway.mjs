// Run on the deployment host as root. This prepares an isolated gateway; it never enables application traffic.
import { execFileSync } from "node:child_process";
import { chmodSync, chownSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { parseEnv } from "node:util";
import process from "node:process";
import console from "node:console";
import path from "node:path";
import { createHash } from "node:crypto";

const environment=process.argv[2];
if(process.platform!=="linux"||process.getuid()!==0||!["development","production"].includes(environment))throw new Error("Usage: root node setup-agent-gateway.mjs development|production");
const image="ghcr.io/yetone/magpie@sha256:871a96aaeed1ea6a6f75767bef6043d4f474aa6ea9d3fe7f25cac9f7fc628d38";
const source=parseEnv(readFileSync("/etc/arknights-infra-agent-private.env","utf8"));
const root=`/var/lib/riic-magpie-${environment}`;const policy=`/var/lib/riic-agent-${environment}`;
const port=environment==="production"?3425:3426;const container=`riic-magpie-${environment}`;
const appRoot=environment==="production"?"/opt/arknights-infra":"/opt/arknights-infra-dev";
const uid=Number(execFileSync("id",["-u","arkinfra"],{encoding:"utf8"}).trim());const gid=Number(execFileSync("id",["-g","arkinfra"],{encoding:"utf8"}).trim());
const vendor=process.env.RIIC_MAGPIE_VENDOR_DIR;
if(!vendor||!path.isAbsolute(vendor)||!existsSync(path.join(vendor,"package/word-guard.middleware.js"))||!existsSync(path.join(vendor,"bun-linux-x64-baseline/bun")))throw new Error("RIIC_MAGPIE_VENDOR_DIR must contain verified word-guard 0.1.1 and Bun 1.4.2");
for(const [file,expected] of [["package/word-guard.middleware.js","f6bbb2609576b266eaaa71ef5e561268bab99009e6d5cea866903b41bd96550e"],["bun-linux-x64-baseline/bun","a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c"]]){
  if(createHash("sha256").update(readFileSync(path.join(vendor,file))).digest("hex")!==expected)throw new Error(`Unverified gateway dependency: ${file}`);
}
for(const directory of [root,`${root}/magpie`,`${root}/home`,`${root}/cache`,`${root}/data`,`${root}/state`]){mkdirSync(directory,{recursive:true,mode:0o700});chownSync(directory,65532,65532);}
mkdirSync(policy,{recursive:true,mode:0o755});chownSync(policy,uid,gid);
mkdirSync("/opt/riic-magpie",{recursive:true,mode:0o755});
const bun="/opt/riic-magpie/bun-1.4.2";
if(!existsSync(bun)){copyFileSync(path.join(vendor,"bun-linux-x64-baseline/bun"),bun);chmodSync(bun,0o755);}
copyFileSync(path.join(vendor,"package/word-guard.middleware.js"),`${policy}/word-guard.middleware.js`);chmodSync(`${policy}/word-guard.middleware.js`,0o644);
if(!existsSync(`${policy}/plugins.json`)){
  writeFileSync(`${policy}/plugins.json`,JSON.stringify({plugins:[{spec:"/riic-policy/word-guard.middleware.js",options:{words:["RIIC_FILTER_BLOCK_TEST","未成年人色情","child pornography"],patterns:[],action:"reject",check:"all",message:"Content rejected by site policy."}}]},null,2)+"\n",{mode:0o644});
  chownSync(`${policy}/plugins.json`,uid,gid);
}
if(!existsSync(`${root}/magpie/providers.json`)){
  const deepseek=source.AGENT_LLM_DEEPSEEK_API_KEY||source.AGENT_LLM_API_KEY;const glm=source.AGENT_LLM_GLM_API_KEY;
  if(!deepseek||!glm)throw new Error("Both existing upstream keys are required");
  const providers=[{id:"riic-deepseek",name:"RIIC DeepSeek",key:deepseek,chat:source.AGENT_LLM_DEEPSEEK_BASE_URL||source.AGENT_LLM_BASE_URL,models:[source.AGENT_LLM_DEEPSEEK_MODEL||source.AGENT_LLM_MODEL],maxConcurrency:4,maxRPM:60,queueLimit:8,queueWait:15},
    {id:"riic-glm",name:"RIIC GLM",key:glm,chat:source.AGENT_LLM_GLM_BASE_URL,models:[source.AGENT_LLM_GLM_MODEL],maxConcurrency:4,maxRPM:60,queueLimit:8,queueWait:15}];
  if(providers.some(p=>!p.chat||!p.models[0]))throw new Error("Upstream settings incomplete");
  writeFileSync(`${root}/magpie/providers.json`,JSON.stringify({providers,groups:[{id:"riic-agent",name:"RIIC Agent",members:["riic-deepseek/deepseek-v4.1-flash","riic-glm/glm-5.3-flash"],routing:"order",affinity:"turn"}]},null,2),{mode:0o600});chownSync(`${root}/magpie/providers.json`,65532,65532);
}
try{symlinkSync("/riic-policy/plugins.json",`${root}/magpie/plugins.json`);}catch(error){if(error.code!=="EEXIST")throw error;}
try{execFileSync("docker",["inspect",container],{stdio:"ignore"});}
catch{execFileSync("docker",["run","-d","--name",container,"--label",`riic.environment=${environment}`,"--restart","unless-stopped","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges:true","--pids-limit","128","--memory","512m","--cpus","1","--tmpfs","/tmp:rw,noexec,nosuid,size=64m","-p",`127.0.0.1:${port}:3425`,"-v",`${root}:/config:rw`,"-v",`${policy}:/riic-policy:ro`,"-v",`${bun}:/opt/riic-bun:ro`,"-e","MAGPIE_NO_ACCOUNTS=1","-e","MAGPIE_BUN=/opt/riic-bun","--log-opt","max-size=10m","--log-opt","max-file=3",image],{stdio:"pipe"});}
const envFile=`/etc/riic-agent-${environment}.env`;
if(!existsSync(envFile)){
  const key=execFileSync("docker",["exec",container,"/magpie","gateway-key","add",`riic-${environment}`],{encoding:"utf8"}).trim();
  if(!/^sk-magpie-[a-zA-Z0-9-]+$/.test(key))throw new Error("Gateway key creation failed");
  const keys=JSON.parse(readFileSync(`${root}/magpie/caller-keys.json`,"utf8"));
  const list=Array.isArray(keys)?keys:keys.keys;
  const entry=list?.find(k=>k.name===`riic-${environment}`||k.label===`riic-${environment}`);
  if(!entry?.id)throw new Error("Cannot identify application gateway key");
  execFileSync("docker",["exec",container,"/magpie","gateway-key","models",entry.id,"group/riic-agent"],{stdio:"pipe"});
  const entries={AGENT_GATEWAY_ENABLED:"0",AGENT_GATEWAY_URL:`http://127.0.0.1:${port}/v1`,AGENT_GATEWAY_KEY:key,AGENT_GATEWAY_POLICY_DIR:policy};
  if(environment==="development")for(const name of ["AGENT_KB_DIR","AGENT_PERSONA_CARD"])if(source[name])entries[name]=source[name];
  writeFileSync(envFile,Object.entries(entries).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join("\n")+"\n",{mode:0o640});chownSync(envFile,0,gid);
}
const unit=`riic-agent-worker-${environment}.service`;
writeFileSync(`/etc/systemd/system/${unit}`,`[Unit]\nDescription=RIIC Agent accounting and gateway maintenance (${environment})\nAfter=network-online.target docker.service\n\n[Service]\nType=simple\nUser=arkinfra\nGroup=arkinfra\nWorkingDirectory=${appRoot}/current/.next/standalone\nEnvironment=NODE_ENV=production\nEnvironmentFile=${envFile}\nExecStart=/usr/local/bin/node ${appRoot}/current/worker/agent-worker.cjs\nRestart=always\nRestartSec=5\nTimeoutStopSec=20\nKillMode=control-group\nMemoryMax=256M\nCPUQuota=50%\nUMask=0022\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=${policy}\n\n[Install]\nWantedBy=multi-user.target\n`,{mode:0o644});
execFileSync("systemctl",["daemon-reload"]);
console.log(JSON.stringify({environment,image,container,port,worker:unit,applicationEnabled:false}));
