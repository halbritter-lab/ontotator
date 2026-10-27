import { useEffect, useRef } from "react";
import { onSessionRestored } from "../api/client";

/** Runs the latest `callback` when the same user logs in again after the session ended (#13): reload what failed meanwhile. */
export function useSessionRestored(callback: () => void): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => onSessionRestored(() => latest.current()), []);
}
