import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type WorkTimeView } from "../src/api/client";
import { formatWorkDuration, formatWorkTime, WorkTimer, type EndReason } from "../src/worktime/workTimer";
import { useWorkTimer, WorkTimeNotice, WorkTimerControl } from "../src/worktime/useWorkTimer";

type Logged = [kind: "open" | "heartbeat", id: string] | [kind: "close", id: string, reason: EndReason];

function machine() {
  const log: Logged[] = [];
  let n = 0;
  const timer = new WorkTimer({
    newId: () => `interval-${++n}`,
    events: {
      open: id => log.push(["open", id]),
      heartbeat: id => log.push(["heartbeat", id]),
      close: (id, reason) => log.push(["close", id, reason]),
    },
  });
  return { timer, log };
}

const minutes = (value: number) => vi.advanceTimersByTime(value * 60_000);

describe("WorkTimer", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T09:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("starts active and sends a heartbeat every minute", () => {
    const { timer, log } = machine();
    timer.start();
    expect(timer.state).toBe("active");
    minutes(2);
    timer.input();
    expect(log).toEqual([["open", "interval-1"], ["heartbeat", "interval-1"], ["heartbeat", "interval-1"]]);
    expect(timer.elapsedMs()).toBe(120_000);
  });

  it("pauses after three minutes without input and resumes on the next input", () => {
    const { timer, log } = machine();
    timer.start();
    minutes(2); timer.input();
    minutes(2.9);
    expect(timer.state).toBe("active");
    minutes(0.1);
    expect(timer.state).toBe("idle");
    expect(log.at(-1)).toEqual(["close", "interval-1", "idle"]);
    minutes(10);
    expect(timer.elapsedMs()).toBe(5 * 60_000);
    timer.input();
    expect(timer.state).toBe("active");
    expect(log.at(-1)).toEqual(["open", "interval-2"]);
  });

  it("pauses when the tab is hidden; becoming visible waits for input", () => {
    const { timer, log } = machine();
    timer.start();
    minutes(1);
    timer.setHidden(true);
    expect(timer.state).toBe("hidden");
    expect(log.at(-1)).toEqual(["close", "interval-1", "hidden"]);
    timer.setHidden(false);
    minutes(5);
    expect(timer.state).toBe("hidden");
    expect(timer.elapsedMs()).toBe(60_000);
    timer.input();
    expect(timer.state).toBe("active");
  });

  it("starts hidden in a background tab without opening an interval", () => {
    const { timer, log } = machine();
    timer.start(true);
    expect(timer.state).toBe("hidden");
    expect(log).toEqual([]);
    timer.input();
    expect(log).toEqual([["open", "interval-1"]]);
  });

  it("keeps a manual pause through input; an edit or Resume ends it", () => {
    const { timer, log } = machine();
    timer.start();
    minutes(1);
    timer.pause();
    expect(log.at(-1)).toEqual(["close", "interval-1", "manual_pause"]);
    timer.input();
    timer.setHidden(true); timer.setHidden(false); timer.input();
    minutes(10);
    expect(timer.state).toBe("paused");
    expect(timer.elapsedMs()).toBe(60_000);
    timer.edit();
    expect(timer.state).toBe("active");
    timer.pause();
    timer.resume();
    expect(timer.state).toBe("active");
    expect(log.filter(entry => entry[0] === "open")).toHaveLength(3);
  });

  it("an edit resumes an idle or hidden timer, and keeps an active one active", () => {
    const { timer } = machine();
    timer.start();
    minutes(2.5); timer.edit();
    minutes(2.5);
    expect(timer.state).toBe("active");
    minutes(1);
    expect(timer.state).toBe("idle");
    timer.edit();
    expect(timer.state).toBe("active");
  });

  it("closes on stop and never restarts", () => {
    const { timer, log } = machine();
    timer.start();
    minutes(1);
    timer.stop();
    expect(log.at(-1)).toEqual(["close", "interval-1", "closed"]);
    timer.input(); timer.edit(); timer.resume(); timer.start();
    minutes(5);
    expect(timer.state).toBe("stopped");
    expect(log).toHaveLength(3);
  });

  it("goes on in a new interval when the server closed the running one", () => {
    const { timer, log } = machine();
    timer.start();
    minutes(1);
    timer.serverClosed("interval-other");
    timer.serverClosed("interval-1");
    expect(timer.intervalId).toBe("interval-2");
    minutes(1);
    expect(timer.elapsedMs()).toBe(120_000);
    expect(log.filter(entry => entry[0] === "close")).toEqual([]);
  });

  it("formats mm:ss below an hour and h:mm from an hour", () => {
    expect(formatWorkTime(0)).toBe("00:00");
    expect(formatWorkTime(245.9)).toBe("04:05");
    expect(formatWorkTime(3599)).toBe("59:59");
    expect(formatWorkTime(3720)).toBe("1:02 h");
  });

  it("formats table sums with units", () => {
    expect(formatWorkDuration(45.5)).toBe("45 s");
    expect(formatWorkDuration(150)).toBe("2 min");
    expect(formatWorkDuration(3900)).toBe("1 h 05 min");
  });
});

function Harness({ enabled = true }: { enabled?: boolean }) {
  const timer = useWorkTimer(7, enabled);
  return <><WorkTimeNotice timer={timer} /><WorkTimerControl timer={timer} /><button onClick={timer.edit}>Edit</button></>;
}

const view = (overrides: Partial<WorkTimeView> = {}): WorkTimeView => ({
  record: true, first_in_project: true, active_seconds: 65, closed: [], heartbeat_seconds: 60, idle_seconds: 180, ...overrides,
});

describe("useWorkTimer", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T09:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("shows the task total, reports intervals and pauses while the tab is hidden", async () => {
    vi.spyOn(api, "getWorkTime").mockResolvedValue(view());
    const report = vi.spyOn(api, "reportWorkTime").mockResolvedValue(view({ first_in_project: false }));
    render(<Harness />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("This project records working time")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Working time" }).textContent).toContain("01:05");
    expect(report).toHaveBeenLastCalledWith(7, [expect.objectContaining({ kind: "open" })]);
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByRole("group", { name: "Working time" }).textContent).toContain("01:35");
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(report).toHaveBeenLastCalledWith(7, [expect.objectContaining({ kind: "close", end_reason: "hidden" })]);
    expect(screen.getByRole("group", { name: "Working time" }).textContent).toContain("auto-paused");
    hidden.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole("group", { name: "Working time" }).textContent).toContain("01:35");
    await act(async () => { fireEvent.keyDown(document.body, { key: "a" }); });
    expect(report).toHaveBeenLastCalledWith(7, [expect.objectContaining({ kind: "open" })]);
  });

  it("Pause timer holds through input until an edit", async () => {
    vi.spyOn(api, "getWorkTime").mockResolvedValue(view({ active_seconds: 0, first_in_project: false }));
    const report = vi.spyOn(api, "reportWorkTime").mockResolvedValue(view());
    render(<Harness />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText("This project records working time")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pause timer" })); });
    expect(report).toHaveBeenLastCalledWith(7, [expect.objectContaining({ kind: "close", end_reason: "manual_pause" })]);
    await act(async () => { fireEvent.pointerDown(document.body); vi.advanceTimersByTime(5_000); });
    expect(screen.getByRole("button", { name: "Resume timer" })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Edit" })); });
    expect(screen.getByRole("button", { name: "Pause timer" })).toBeTruthy();
  });

  it("shows nothing and sends nothing when the project records no time", async () => {
    vi.spyOn(api, "getWorkTime").mockResolvedValue(view({ record: false, first_in_project: false }));
    const report = vi.spyOn(api, "reportWorkTime");
    const { container } = render(<Harness />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("group", { name: "Working time" })).toBeNull();
    await act(async () => { fireEvent.keyDown(document.body, { key: "a" }); vi.advanceTimersByTime(120_000); });
    expect(report).not.toHaveBeenCalled();
    expect(container.textContent).toBe("Edit");
  });

  it("closes the interval with keepalive when the task closes", async () => {
    vi.spyOn(api, "getWorkTime").mockResolvedValue(view());
    let release!: () => void;
    const report = vi.spyOn(api, "reportWorkTime").mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(view()); }))
      .mockResolvedValue(view());
    const { unmount } = render(<Harness />);
    await act(async () => { await Promise.resolve(); });
    unmount();
    expect(report).toHaveBeenLastCalledWith(7, [expect.objectContaining({ kind: "open" }), expect.objectContaining({ kind: "close", end_reason: "closed" })], { keepalive: true });
    release();
  });
});
