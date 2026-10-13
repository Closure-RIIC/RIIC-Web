type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
type TimerContext = {
  getExtension(name: string): unknown;
  getParameter(parameter: number): unknown;
  createQuery(): WebGLQuery | null;
  beginQuery(target: number, query: WebGLQuery): void;
  endQuery(target: number): void;
  getQueryParameter(query: WebGLQuery, parameter: number): unknown;
  deleteQuery(query: WebGLQuery): void;
  isContextLost(): boolean;
  QUERY_RESULT_AVAILABLE: number;
  QUERY_RESULT: number;
};

/** GPU execution time only. Query availability is checked without waiting or finishing. */
export function createFurGpuTimer(gl: TimerContext) {
  const extension = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null;
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  let latest: number | null = null;
  let disposed = false;
  const clearPending = () => {
    for (const query of pending) gl.deleteQuery(query);
    pending.length = 0;
    latest = null;
  };
  const poll = () => {
    if (!extension || disposed) return false;
    if (gl.isContextLost() || gl.getParameter(extension.GPU_DISJOINT_EXT)) {
      clearPending();
      return false;
    }
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = pending.shift()!;
      const nanoseconds = Number(gl.getQueryParameter(query, gl.QUERY_RESULT));
      gl.deleteQuery(query);
      latest = Number.isFinite(nanoseconds) && nanoseconds >= 0 ? nanoseconds / 1e6 : null;
    }
    return true;
  };
  return {
    begin() {
      // A slow or unsupported driver must not grow an unbounded query queue.
      if (!poll() || active || pending.length >= 3) return;
      active = gl.createQuery();
      if (active) gl.beginQuery(extension!.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!active) return;
      gl.endQuery(extension!.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    milliseconds() { poll(); return latest; },
    dispose() {
      if (disposed) return;
      if (active) {
        if (!gl.isContextLost()) gl.endQuery(extension!.TIME_ELAPSED_EXT);
        gl.deleteQuery(active);
        active = null;
      }
      clearPending();
      disposed = true;
    },
  };
}
