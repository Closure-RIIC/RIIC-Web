export const TELEMETRY_INTERVAL_MS = 5_000;
const MAX_PENDING = 100;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 3;

export function retryAfterMs(value: string | null, now: number): number {
  if (!value) return 0;
  const delay = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, Math.min(delay, 3_600_000)) : 0;
}

/** Bounded, single-flight, response-aware analytics. Never reports its own failures. */
export function createTelemetryQueue<T>(dependencies: {
  send: (events: T[]) => Promise<{status: number; retryAfter: string | null}>;
  beacon: (events: T[]) => boolean;
  now: () => number;
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
  readCooldown: () => number;
  writeCooldown: (until: number) => void;
}) {
  let queue: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let cooldown = 0;
  let attempts = 0;
  let disposed = false;
  let dropped = 0;
  const deadline = () => Math.max(cooldown, dependencies.readCooldown());
  const schedule = () => {
    if (disposed || timer !== undefined || inFlight || !queue.length) return;
    timer = dependencies.schedule(() => { timer=undefined; void flush(); }, Math.max(TELEMETRY_INTERVAL_MS,deadline()-dependencies.now()));
  };
  const flush = async () => {
    if (disposed || inFlight || !queue.length) return;
    if (timer !== undefined) { dependencies.cancel(timer); timer=undefined; }
    if (dependencies.now() < deadline()) { schedule(); return; }
    const batch=queue.splice(0,BATCH_SIZE);
    inFlight=true;
    let response: {status:number; retryAfter:string|null};
    try { response=await dependencies.send(batch); }
    catch { response={status:0,retryAfter:null}; }
    inFlight=false;
    if (disposed) return;
    if (response.status===429 || response.status>=500 || response.status===0) {
      attempts++;
      const delay=Math.max(retryAfterMs(response.retryAfter,dependencies.now()),Math.min(60_000,5_000*2**(attempts-1)));
      cooldown=dependencies.now()+delay;
      if (response.status===429) dependencies.writeCooldown(cooldown);
      if (attempts<MAX_ATTEMPTS) {
        const combined=[...batch,...queue];
        dropped+=Math.max(0,combined.length-MAX_PENDING);
        queue=combined.slice(0,MAX_PENDING);
      } else {
        dropped+=batch.length;
        attempts=0;
        cooldown=Math.max(cooldown,dependencies.now()+60_000);
      }
    } else {
      // Non-retryable malformed events are not sent repeatedly.
      if (response.status<200 || response.status>=300) dropped+=batch.length;
      attempts=0;
    }
    schedule();
  };
  return {
    enqueue(event:T) {
      if (disposed) return;
      if (queue.length>=MAX_PENDING) { dropped++; return; }
      queue.push(event);
      schedule();
    },
    flush,
    hide() {
      if (disposed || inFlight || !queue.length || dependencies.now()<deadline()) return;
      const batch=queue.slice(0,BATCH_SIZE);
      // Beacon is ONLY an unload fallback. It cannot acknowledge HTTP acceptance.
      if (dependencies.beacon(batch)) queue.splice(0,batch.length);
      else void flush();
    },
    dispose() { disposed=true; if(timer!==undefined) dependencies.cancel(timer); queue=[]; },
    inspect: () => ({pending:queue.length,inFlight,dropped,cooldown:deadline()}),
  };
}
