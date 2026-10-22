import { useCallback, useEffect, useRef, useState } from "react";

export function useAuthRequest(active: boolean) {
  const version = useRef(0);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const invalidate = useCallback(() => {
    version.current += 1;
    pending.current = false;
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!active) invalidate();
    return () => {
      version.current += 1;
      pending.current = false;
    };
  }, [active, invalidate]);

  const begin = () => {
    if (!active || pending.current) return null;
    pending.current = true;
    setBusy(true);
    return ++version.current;
  };
  const isCurrent = (request: number) => active && version.current === request;
  const finish = (request: number) => {
    if (!isCurrent(request)) return;
    pending.current = false;
    setBusy(false);
  };
  return { busy, begin, isCurrent, finish, invalidate };
}
