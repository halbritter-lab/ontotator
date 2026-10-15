import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import { errorMessage } from "../src/admin/errors";

describe("shared API error messages", () => {
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
