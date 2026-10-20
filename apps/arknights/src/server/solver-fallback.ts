import { createHash } from "node:crypto";
import { accessSync, constants, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export type SolverFallbackConfig = { cliPath: string; dataDir: string; sha256: string; dataSha256: string };

/** Hash sorted relative POSIX paths and file hashes; reject links and special files. */
export function hashSolverDataDirectory(root: string): string {
  if(!lstatSync(root).isDirectory()) throw new Error("Fallback data root must be a directory, not a symlink.");
  const digest=createHash("sha256");
  function visit(relative: string) {
    for(const entry of readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name=relative ? `${relative}/${entry.name}` : entry.name;
      if(entry.isDirectory()) visit(name);
      else if(entry.isFile()) digest.update(JSON.stringify([name,createHash("sha256").update(readFileSync(path.join(root,name))).digest("hex")])+"\n");
      else throw new Error("Fallback data contains a symlink or special file.");
    }
  }
  visit("");
  return digest.digest("hex");
}

export function readSolverFallbackConfig(env: Record<string,string|undefined> = process.env): SolverFallbackConfig | null {
  const cliPath=env.INFRA_FALLBACK_CLI_PATH?.trim();
  const dataDir=env.INFRA_FALLBACK_DATA_DIR?.trim();
  const sha256=env.INFRA_FALLBACK_CLI_SHA256?.trim();
  const dataSha256=env.INFRA_FALLBACK_DATA_SHA256?.trim();
  if (!cliPath && !dataDir && !sha256 && !dataSha256) return null;
  if (!cliPath || !dataDir || !sha256 || !path.isAbsolute(cliPath) || !path.isAbsolute(dataDir)
    || !/^[a-f0-9]{64}$/.test(sha256) || !dataSha256 || !/^[a-f0-9]{64}$/.test(dataSha256)) throw new Error("Incomplete or invalid pinned fallback solver configuration.");
  return {cliPath,dataDir,sha256,dataSha256};
}

let verifiedConfig: {key:string; value:SolverFallbackConfig} | undefined;
export function verifySolverFallbackConfig(): SolverFallbackConfig | null {
  const config=readSolverFallbackConfig();
  if (!config) return null;
  const key=JSON.stringify(config);
  // Data is checked at startup and before each run, even after a warm ping.
  if (hashSolverDataDirectory(config.dataDir)!==config.dataSha256) throw new Error("Fallback solver data SHA-256 mismatch.");
  if (verifiedConfig?.key===key) return verifiedConfig.value;
  const cliPath=realpathSync(config.cliPath); const dataDir=realpathSync(config.dataDir);
  if (!statSync(cliPath).isFile() || !statSync(dataDir).isDirectory()) throw new Error("Fallback solver paths are not a file and data directory.");
  accessSync(cliPath,constants.X_OK);
  if (createHash("sha256").update(readFileSync(cliPath)).digest("hex")!==config.sha256) throw new Error("Fallback solver executable SHA-256 mismatch.");
  verifiedConfig={key,value:{...config,cliPath,dataDir}};
  return verifiedConfig.value;
}

/** Serialize the whole primary/fallback pair, not just each individual process. */
const laneTails=new Map<number,Promise<void>>();
export async function withSolverLane<T>(lane:number,run:()=>Promise<T>):Promise<T> {
  const previous=laneTails.get(lane) ?? Promise.resolve();
  let unlock!:()=>void;
  const tail=new Promise<void>(resolve=>{unlock=resolve;});
  laneTails.set(lane,tail);
  await previous;
  try {return await run();}
  finally {unlock();if(laneTails.get(lane)===tail)laneTails.delete(lane);}
}

export async function withinSolverDeadline<T>(run:()=>Promise<T>,milliseconds:number,stop:()=>void):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const expired=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{stop();reject(new Error("Solver attempt timeout."));},Math.max(1,milliseconds));
  });
  try {return await Promise.race([run(),expired]);}
  finally {clearTimeout(timer);}
}

export class SolverFallbackFailure extends Error {
  readonly primaryError:unknown;
  readonly fallbackError:unknown;
  constructor(primaryError:unknown,fallbackError:unknown) {
    super(`Primary solver failed: ${errorMessage(primaryError)}; fallback solver failed: ${errorMessage(fallbackError)}`,{cause:fallbackError});
    this.name="SolverFallbackFailure";
    this.primaryError=primaryError;
    this.fallbackError=fallbackError;
  }
}
function errorMessage(error:unknown) {return error instanceof Error ? error.message : String(error);}

/** A policy fallback, not an optimality guarantee. Both attempts share one budget. */
export async function runWithSolverFallback<T>(options:{
  primary:(budgetMs:number)=>Promise<T>;
  fallback?:(budgetMs:number)=>Promise<T>;
  budgetMs:number;
  onPrimaryFailure?:(error:unknown)=>Promise<void>;
  now?:()=>number;
}):Promise<{value:T;fallbackUsed:boolean}> {
  const now=options.now ?? performance.now.bind(performance);
  const started=now();
  try {
    return {value:await options.primary(options.fallback ? Math.max(1,Math.floor(options.budgetMs*0.75)) : options.budgetMs),fallbackUsed:false};
  } catch(primaryError) {
    if (!options.fallback) throw primaryError;
    await options.onPrimaryFailure?.(primaryError);
    const remaining=Math.floor(options.budgetMs-(now()-started));
    if (remaining<=0) throw new SolverFallbackFailure(primaryError,new Error("Total solver timeout budget exhausted."));
    try {return {value:await options.fallback(remaining),fallbackUsed:true};}
    catch(fallbackError) {throw new SolverFallbackFailure(primaryError,fallbackError);}
  }
}
