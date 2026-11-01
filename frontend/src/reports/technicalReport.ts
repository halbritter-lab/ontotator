import { lastApiError, type TechnicalReportContext } from "../api/client";

/** Bounds of the server (TechnicalReportRequest); the form never sends more. */
export const MAX_DESCRIPTION = 4000;
const MAX_ROUTE = 300;
const MAX_CRASH_MESSAGE = 2000;

/** The entry's label in the editor's More menu, the navigation and the crash screen. */
export const REPORT_ENTRY_LABEL = "Report a technical problem…";
/** The same entry in the narrow navigation, on one line. */
export const REPORT_NAV_LABEL = "Technical problem…";

/**
 * What the app adds to a report: the screen's address without its query (filters may hold searched text),
 * the window size, the last refused API request of this tab and, from the crash screen, the error message.
 * Every read is guarded: the crash screen calls this while the app may be broken.
 */
export function reportContext(crashMessage?: string): TechnicalReportContext {
  const context: TechnicalReportContext = {};
  try {
    const route = window.location.hash.split("?", 1)[0];
    if (route) context.route = route.slice(0, MAX_ROUTE);
  } catch { /* no address */ }
  try {
    const width = Math.round(window.innerWidth), height = Math.round(window.innerHeight);
    if (width > 0 && height > 0 && width < 100000 && height < 100000) context.viewport = `${width}x${height}`;
  } catch { /* no window size */ }
  const error = lastApiError();
  if (error) context.last_api_error = { status: error.status, code: error.code, at: error.at };
  const message = crashMessage?.trim();
  if (message) context.crash_message = message.slice(0, MAX_CRASH_MESSAGE);
  return context;
}

// The one report dialog of the app (TechnicalReportHost), opened from menus anywhere.
type Listener = () => void;
const listeners = new Set<Listener>();
let openState = false;
const publish = (open: boolean) => {
  openState = open;
  for (const listener of [...listeners]) listener();
};

export function openTechnicalReport(): void { publish(true); }
export function closeTechnicalReport(): void { publish(false); }
export const subscribeTechnicalReport = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const technicalReportOpen = (): boolean => openState;
