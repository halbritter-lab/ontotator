/**
 * Test helpers for the logged-in user (T2b): the identity comes from the session.
 */
import { vi } from "vitest";
import { api, type CurrentUser } from "../src/api/client";

/** A logged-in system administrator whose username is derived from the pseudonym. */
export const testUser = (pseudonym: string, overrides: Partial<CurrentUser> = {}): CurrentUser => ({
  username: `user-${pseudonym.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  display_name: pseudonym,
  pseudonym,
  is_system_admin: true,
  csrf_token: "csrf-test",
  ...overrides,
});

/** Let `api.me()` answer with this user, as an App rendered without a user asks for it. */
export const loggedInAs = (pseudonym: string, overrides: Partial<CurrentUser> = {}) =>
  vi.spyOn(api, "me").mockResolvedValue(testUser(pseudonym, overrides));
