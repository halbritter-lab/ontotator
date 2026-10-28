import { useCallback, useEffect, useReducer, useRef } from "react";

type AxisValues = Record<string, string | null>;

/**
 * Local axis choices that reach the server coalesced: a change is sent `delayMs` after the last change
 * within the same axis, a change of another axis sends the pending one first. Sent values stay shown
 * until the base (the saved values) changes, so the radios never flicker back while a save runs.
 * A failed save (rejected promise from `send`) drops the sent values, so the saved value shows again.
 */
export function useCoalescedAxisChange(
  base: Readonly<AxisValues>,
  send: (values: AxisValues) => void | Promise<unknown>,
  delayMs = 300,
): {
  values: AxisValues;
  change: (axisId: string, value: string | null) => void;
  flush: () => void;
} {
  const baseKey = JSON.stringify(base);
  const baseRef = useRef(base);
  baseRef.current = base;
  const sendRef = useRef(send);
  sendRef.current = send;
  // Values already sent, valid only for the base they were sent against.
  const sent = useRef<{ key: string; values: AxisValues }>({ key: baseKey, values: {} });
  const pending = useRef<{ axisId: string; value: string | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const refresh = () => { if (mounted.current) rerender(); };

  const sentFor = (key: string) => (sent.current.key === key ? sent.current.values : {});

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const choice = pending.current;
    if (!choice) return;
    pending.current = null;
    const key = JSON.stringify(baseRef.current);
    const already = sentFor(key);
    // Back to the saved value with nothing sent: there is nothing to save.
    if (Object.keys(already).length === 0 && (baseRef.current[choice.axisId] ?? null) === choice.value) {
      refresh();
      return;
    }
    const local = { ...already, [choice.axisId]: choice.value };
    sent.current = { key, values: local };
    const result = sendRef.current({ ...baseRef.current, ...local });
    if (result && typeof (result as Promise<unknown>).then === "function") {
      (result as Promise<unknown>).then(undefined, () => {
        if (sent.current.key !== key) return;
        sent.current = { key, values: {} };
        refresh();
      });
    }
    refresh();
  }, []);

  const change = useCallback((axisId: string, value: string | null) => {
    if (pending.current && pending.current.axisId !== axisId) flush();
    pending.current = { axisId, value };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delayMs);
    rerender();
  }, [flush, delayMs]);

  // A choice still waiting is sent when the panel goes away (another finding, closing the editor).
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; flush(); };
  }, [flush]);

  const values: AxisValues = {
    ...base,
    ...sentFor(baseKey),
    ...(pending.current ? { [pending.current.axisId]: pending.current.value } : {}),
  };
  return { values, change, flush };
}
