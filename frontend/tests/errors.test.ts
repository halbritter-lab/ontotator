// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import { ERROR_MESSAGES, errorMessage } from "../src/admin/errors";
import backendCodes from "../../contracts/admin-error-codes.json";

describe("shared API error messages", () => {
  it("maps every code from the actual committed backend catalog export", () => {
    expect(backendCodes.length).toBeGreaterThan(0);
    const missing = backendCodes.filter(code => !Object.hasOwn(ERROR_MESSAGES, code) || !ERROR_MESSAGES[code]?.trim());
    expect(missing).toEqual([]);
  });

  it("preserves the server's specific ORCID validation message", () => {
    expect(errorMessage(new ApiError(422, "ORCID checksum is invalid.", "ORCID_INVALID"))).toBe("ORCID checksum is invalid.");
  });
  it("gives a useful explanation for a known access code", () => {
    expect(errorMessage(new ApiError(404, "raw", "PROJECT_NOT_FOUND"))).toContain("You do not have access to this project");
  });

  it.each(["FUTURE_CODE", "toString", "constructor"])("uses the server message for unmapped code %s", code => {
    expect(errorMessage(new ApiError(500, "Server explanation", code))).toBe("Server explanation");
  });

  it("handles network errors and unknown thrown values without displaying object internals", () => {
    expect(errorMessage(new Error("Network unavailable"))).toBe("Network unavailable");
    expect(errorMessage({ secret: "not UI text" })).toBe("Something went wrong. Please try again.");
  });
});

it("explains the pending reanchor count and unsupported flagged re-import", () => {
  expect(errorMessage(new ApiError(422, "raw", "REANCHOR_ITEMS_UNRESOLVED", { count: 3 }))).toBe("3 finding(s) after text correction still need review. Re-create them or dismiss them with a reason before submitting.");
  expect(errorMessage(new ApiError(422, "raw", "UNSUPPORTED_REVIEW_RESOLUTION"))).toContain("cannot currently be re-imported into proposal storage");
});
