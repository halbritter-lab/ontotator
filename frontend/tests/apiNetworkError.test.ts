import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ErrorNotice } from "../src/admin/ErrorNotice";
import { errorMessage } from "../src/admin/errors";
import { api, NetworkError } from "../src/api/client";
import { isNetworkError } from "../src/editor/autosave";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("a failed fetch becomes NetworkError with the calm message", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
  const error = await api.listProjects().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(NetworkError);
  expect(errorMessage(error)).toBe("Connection lost. Try again.");
  expect((error as NetworkError).cause).toBeInstanceOf(TypeError);
  // The editor's offline state still recognises it.
  expect(isNetworkError(error)).toBe(true);
});

it("aborts stay aborts", async () => {
  const abort = new DOMException("The operation was aborted.", "AbortError");
  vi.spyOn(globalThis, "fetch").mockRejectedValue(abort);
  await expect(api.listProjects()).rejects.toBe(abort);
});

it("ErrorNotice offers Try again when given onRetry", () => {
  const onRetry = vi.fn();
  render(createElement(ErrorNotice, { error: new NetworkError(new TypeError("Failed to fetch")), onRetry }));
  expect(screen.getByRole("alert").textContent).toContain("Connection lost. Try again.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(onRetry).toHaveBeenCalledOnce();
  cleanup();
  render(createElement(ErrorNotice, { error: new Error("x") }));
  expect(screen.queryByRole("button")).toBeNull();
});
