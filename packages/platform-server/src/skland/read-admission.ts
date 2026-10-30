/** No waiting queue: overload is rejected before credentials or upstream connections are opened. */
export function createReadAdmission(maxConcurrent: number, unavailable: () => Error) {
  let active = 0;
  return async function admit<T>(read: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) throw unavailable();
    active++;
    try { return await read(); }
    finally { active--; }
  };
}
