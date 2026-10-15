import { ApiError } from "../api/client";

/** Messages grow with their consumers; this is not a backend-code catalog. */
export const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  NOT_AUTHENTICATED: "Your session has ended. Please log in again.",
  NOT_ALLOWED: "You do not have permission to do this.",
  PROJECT_NOT_FOUND: "You do not have access to this project, or it no longer exists.",
  ASSIGNMENT_REQUIRED: "This task is no longer assigned to you.",
  ASSIGNMENT_NOT_FOUND: "This task is no longer assigned to you.",
  DOCUMENT_NOT_FOUND: "This document is no longer available to you.",
  INVALID_ONTOLOGY: "The ontology could not be read. Check the file and try again.",
  T1_TOOL_PROVENANCE: "The imported tool provenance is incomplete or invalid.",
  DISTRIBUTION_STALE: "Assignments have changed. Generate a new proposal before confirming.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code && Object.hasOwn(ERROR_MESSAGES, error.code)) {
    return ERROR_MESSAGES[error.code];
  }
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong. Please try again.";
}
