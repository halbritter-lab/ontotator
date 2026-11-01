/**
 * The last refused API request of this tab, for a technical report (#259). In memory only: never stored,
 * never sent anywhere until the user sends a report. It holds the HTTP status, the error code and the time,
 * not the address or the answer, which may name texts.
 */
export interface LastApiError {
  /** HTTP status; 0 for a request that got no answer (connection lost). */
  status: number;
  code: string | null;
  /** ISO time the answer arrived. */
  at: string;
}

let last: LastApiError | null = null;
const CODE = /^[A-Z0-9_]{1,64}$/;

export function recordApiError(status: number, code: string | undefined, at: Date = new Date()): void {
  last = { status, code: code && CODE.test(code) ? code : null, at: at.toISOString() };
}

export function lastApiError(): LastApiError | null {
  return last;
}

/** Tests only: forget the recorded error. */
export function resetLastApiError(): void {
  last = null;
}
