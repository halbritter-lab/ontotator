import { useEffect, useRef, useState } from "react";
import { api, type WorkTimeItem, type WorkTimeView } from "../api/client";
import { Button, InlineMessage } from "../ui";
import { formatWorkTime, WorkTimer, type EndReason, type TimerState } from "./workTimer";

/** Input that counts as working: keyboard, pointer, scroll and text selection. */
const INPUT_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "scroll", "selectionchange"] as const;
const MAX_BATCH = 50;

/**
 * Sends the timer's events in order, one request at a time. A failed batch stays queued and goes with the
 * next one; the server ignores items it already has (idempotent by interval id).
 */
export class WorkTimeReporter {
  private queue: WorkTimeItem[] = [];
  private sending = false;
  constructor(private readonly assignmentId: number, private readonly onResult: (view: WorkTimeView) => void) {}

  push(intervalId: string, kind: WorkTimeItem["kind"], reason?: EndReason): void {
    this.queue.push({ interval_id: intervalId, kind, client_at: new Date().toISOString(), ...(reason ? { end_reason: reason } : {}) });
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.sending || !this.queue.length) return;
    this.sending = true;
    const batch = this.queue.slice(0, MAX_BATCH);
    try {
      const view = await api.reportWorkTime(this.assignmentId, batch);
      this.queue = this.queue.filter(item => !batch.includes(item));
      this.onResult(view);
    } catch { /* Kept for the next batch. */ }
    finally { this.sending = false; }
    if (this.queue.length && !this.sending) void this.flush();
  }

  /** The tab closes or the task is left: send what is left, even while a request runs. */
  flushOnUnload(): void {
    if (!this.queue.length) return;
    const batch = this.queue.slice(0, MAX_BATCH);
    this.queue = this.queue.slice(batch.length);
    void api.reportWorkTime(this.assignmentId, batch, { keepalive: true }).catch(() => undefined);
  }
}

export interface WorkTimerHandle {
  /** The task records working time: show the timer. */
  record: boolean;
  firstInProject: boolean;
  state: TimerState;
  /** The owner's time on this task: earlier sessions plus this one. */
  seconds: number;
  pause: () => void;
  resume: () => void;
  /** Call on every change to the annotation (an edit command); it resumes a manual pause. */
  edit: () => void;
}

/** Runs the timer of one open, editable task; does nothing while `enabled` is false or the project records no time. */
export function useWorkTimer(assignmentId: number, enabled: boolean): WorkTimerHandle {
  const [view, setView] = useState<WorkTimeView | null>(null);
  const [state, setState] = useState<TimerState>("stopped");
  const [, tick] = useState(0);
  const timer = useRef<WorkTimer | null>(null);
  const base = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let reporter: WorkTimeReporter | null = null;
    const removers: (() => void)[] = [];
    void api.getWorkTime(assignmentId).then(initial => {
      if (!alive) return;
      setView(initial);
      if (!initial.record) return;
      base.current = initial.active_seconds;
      reporter = new WorkTimeReporter(assignmentId, result => {
        if (!alive) return;
        if (!result.record) { timer.current?.stop(); return; }
        const id = timer.current?.intervalId;
        if (id && result.closed.includes(id)) timer.current?.serverClosed(id);
      });
      const current = new WorkTimer({
        idleMs: initial.idle_seconds * 1000, heartbeatMs: initial.heartbeat_seconds * 1000,
        events: {
          open: id => reporter?.push(id, "open"),
          heartbeat: id => reporter?.push(id, "heartbeat"),
          close: (id, reason) => reporter?.push(id, "close", reason),
          change: next => { if (alive) setState(next); },
        },
      });
      timer.current = current;
      const input = () => current.input();
      for (const name of INPUT_EVENTS) {
        document.addEventListener(name, input, { capture: true, passive: true });
        removers.push(() => document.removeEventListener(name, input, { capture: true }));
      }
      const visibility = () => current.setHidden(document.visibilityState === "hidden");
      document.addEventListener("visibilitychange", visibility);
      removers.push(() => document.removeEventListener("visibilitychange", visibility));
      const leave = () => { current.stop(); reporter?.flushOnUnload(); };
      window.addEventListener("pagehide", leave);
      removers.push(() => window.removeEventListener("pagehide", leave));
      current.start(document.visibilityState === "hidden");
      const seconds = setInterval(() => { if (alive) tick(n => n + 1); }, 1000);
      removers.push(() => clearInterval(seconds));
    }, () => { /* No timer when the state cannot be read. */ });
    return () => {
      alive = false;
      for (const remove of removers) remove();
      timer.current?.stop();
      reporter?.flushOnUnload();
      timer.current = null;
    };
  }, [assignmentId, enabled]);
  const record = enabled && view?.record === true;
  return {
    record, firstInProject: record && view?.first_in_project === true, state,
    seconds: base.current + Math.floor((timer.current?.elapsedMs() ?? 0) / 1000),
    pause: () => timer.current?.pause(),
    resume: () => timer.current?.resume(),
    edit: () => timer.current?.edit(),
  };
}

const STATE_NOTES: Record<TimerState, string> = {
  active: "Counting",
  idle: "Paused: no input for 3 minutes. Continue working to resume.",
  hidden: "Paused while the tab was in the background. Continue working to resume.",
  paused: "Paused. Resume, or change an annotation, to count again.",
  stopped: "Stopped",
};

/** The editor header's timer: own active time on this task and Pause/Resume. */
export function WorkTimerControl({ timer }: { timer: WorkTimerHandle }): JSX.Element | null {
  if (!timer.record) return null;
  const running = timer.state === "active";
  const manual = timer.state === "paused";
  return <span className={`work-timer work-timer--${timer.state}`} role="group" aria-label="Working time">
    <span className="work-timer__value" title={`Your working time on this task. ${STATE_NOTES[timer.state]}`}>
      <span className="visually-hidden">Working time </span>{formatWorkTime(timer.seconds)}
      {!running && <span className="work-timer__state"> {manual ? "paused" : "auto-paused"}</span>}
    </span>
    {manual
      ? <Button size="sm" variant="quiet" onClick={timer.resume}>Resume timer</Button>
      : <Button size="sm" variant="quiet" onClick={timer.pause} disabled={timer.state === "stopped"}>Pause timer</Button>}
  </span>;
}

/** Shown once, on the person's first task in a project that records working time. */
export function WorkTimeNotice({ timer }: { timer: WorkTimerHandle }): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  if (!timer.firstInProject || dismissed) return null;
  return <InlineMessage tone="info" title="This project records working time" onDismiss={() => setDismissed(true)}>
    <p>The timer next to "Pause timer" counts your active time on each task. It pauses after 3 minutes without input (those 3 minutes still count) and while the tab is in the background, and you can pause it yourself. Project leads see only sums per text, never your single work periods.</p>
  </InlineMessage>;
}
