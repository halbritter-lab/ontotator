/**
 * Working time of one open task (issue 298): a small state machine without React or DOM.
 *
 * - `active`: an interval runs. It starts when the task opens and on the first input after a pause.
 * - `idle`: no input (keyboard, pointer, scroll, selection) for `idleMs`; the next input resumes.
 * - `hidden`: the tab was hidden; the next input resumes (becoming visible alone does not).
 * - `paused`: paused by hand. Input does not resume it; Resume or an edit of the annotation does.
 * - `stopped`: the task closed, or the server records no time for it.
 *
 * An interval ends at the moment of the pause, so the idle wait counts as reading time. Every start and
 * end, and a heartbeat every `heartbeatMs` while active, go to `events`; the server keeps its own times.
 */

export type TimerState = "active" | "idle" | "hidden" | "paused" | "stopped";
export type EndReason = "idle" | "hidden" | "manual_pause" | "closed";

export interface TimerEvents {
  open: (intervalId: string) => void;
  heartbeat: (intervalId: string) => void;
  close: (intervalId: string, reason: EndReason) => void;
  change?: (state: TimerState) => void;
}

export interface WorkTimerOptions {
  events: TimerEvents;
  idleMs?: number;
  heartbeatMs?: number;
  now?: () => number;
  newId?: () => string;
}

export const IDLE_MS = 180_000;
export const HEARTBEAT_MS = 60_000;

export class WorkTimer {
  private current: TimerState = "stopped";
  private started = false;
  private interval: string | null = null;
  private startedAt = 0;
  private lastInput = 0;
  private accumulated = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly idleMs: number;
  private readonly heartbeatMs: number;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly events: TimerEvents;

  constructor(options: WorkTimerOptions) {
    this.events = options.events;
    this.idleMs = options.idleMs ?? IDLE_MS;
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  get state(): TimerState { return this.current; }
  get intervalId(): string | null { return this.interval; }

  /** Local active milliseconds since this timer was created (closed intervals plus the running one). */
  elapsedMs(): number {
    return this.accumulated + (this.current === "active" ? Math.max(this.now() - this.startedAt, 0) : 0);
  }

  /** The task opened; in a hidden tab the first input starts the interval. */
  start(hidden = false): void {
    if (this.current !== "stopped" || this.started) return;
    this.started = true;
    if (hidden) this.set("hidden"); else this.open();
  }

  /** Keyboard, pointer, scroll or selection input. */
  input(): void {
    if (this.current === "active") this.lastInput = this.now();
    else if (this.current === "idle" || this.current === "hidden") this.open();
  }

  /** A change to the annotation: resumes even a manual pause. */
  edit(): void {
    if (this.current === "active") this.lastInput = this.now();
    else if (this.current !== "stopped") this.open();
  }

  setHidden(hidden: boolean): void { if (hidden && this.current === "active") this.end("hidden", "hidden"); }

  pause(): void {
    if (this.current === "active") this.end("manual_pause", "paused");
    else if (this.current === "idle" || this.current === "hidden") this.set("paused");
  }

  resume(): void { if (this.current === "paused") this.open(); }

  /** The task closes; nothing restarts afterwards. */
  stop(): void {
    if (this.current === "active") this.end("closed", "stopped");
    else this.set("stopped");
    this.clearTimers();
  }

  /** The server holds this interval closed (lost after a silence): go on in a new one. */
  serverClosed(intervalId: string): void {
    if (this.current !== "active" || intervalId !== this.interval) return;
    this.accumulated += Math.max(this.now() - this.startedAt, 0);
    this.clearTimers();
    this.interval = null;
    this.open();
  }

  private open(): void {
    this.interval = this.newId();
    this.startedAt = this.now();
    this.lastInput = this.startedAt;
    this.set("active");
    this.events.open(this.interval);
    this.scheduleIdle(this.idleMs);
    const id = this.interval;
    this.heartbeatTimer = setInterval(() => { if (this.interval === id) this.events.heartbeat(id); }, this.heartbeatMs);
  }

  private end(reason: EndReason, next: TimerState): void {
    const id = this.interval;
    this.accumulated += Math.max(this.now() - this.startedAt, 0);
    this.clearTimers();
    this.interval = null;
    this.set(next);
    if (id !== null) this.events.close(id, reason);
  }

  /** One timeout per idle period, not per input: it checks the last input when it fires. */
  private scheduleIdle(delay: number): void {
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.current !== "active") return;
      const quiet = this.now() - this.lastInput;
      if (quiet >= this.idleMs) this.end("idle", "idle");
      else this.scheduleIdle(this.idleMs - quiet);
    }, delay);
  }

  private clearTimers(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.idleTimer = null; this.heartbeatTimer = null;
  }

  private set(state: TimerState): void {
    if (this.current === state) return;
    this.current = state;
    this.events.change?.(state);
  }
}

/** "04:05" below an hour (mm:ss), "1:02 h" from an hour (h:mm). */
export function formatWorkTime(seconds: number): string {
  const total = Math.max(Math.floor(seconds), 0);
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), rest = total % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")} h` : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** Sums in tables: "45 s", "2 min", "1 h 05 min", so they never read as a clock. */
export function formatWorkDuration(seconds: number): string {
  const total = Math.max(Math.floor(seconds), 0);
  if (total < 60) return `${total} s`;
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours} h ${String(minutes).padStart(2, "0")} min` : `${minutes} min`;
}
