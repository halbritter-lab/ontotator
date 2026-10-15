import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AppShell } from "../../src/ui/AppShell";
import type { CurrentUser } from "../../src/api/client";
const user = { username: "alex", display_name: "Alex", pseudonym: "a1" } as CurrentUser;
it("shows_product_user_and_logout", () => {
  const logout = vi.fn(); render(<AppShell user={user} onLogout={logout}>Content</AppShell>);
  expect(screen.getByText("Ontocurator")).toBeTruthy();
  expect(screen.getByText("Clinical Curation Workbench")).toBeTruthy();
  expect(screen.getByTestId("current-user").title).toBe("Logged in as alex");
  expect(screen.getByTestId("current-user").textContent).toBe("Alex · a1");
  screen.getByRole("button", { name: "Log out" }).click(); expect(logout).toHaveBeenCalledOnce();
});
it("no_logout_without_handler", () => { render(<AppShell user={user}>Content</AppShell>); expect(screen.queryByRole("button", { name: "Log out" })).toBeNull(); });
it("breadcrumb_marks_the_current_page", () => {
  const back = vi.fn(); render(<AppShell user={null} breadcrumb={[{ label: "Projects", href: "/projects" }, { label: "Project", onClick: back }, { label: "Case 1" }]}>Content</AppShell>);
  expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
  expect(screen.getByText("Case 1").getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Projects" }).getAttribute("href")).toBe("/projects");
  screen.getByRole("button", { name: "Project" }).click(); expect(back).toHaveBeenCalledOnce();
});
it("side_nav_only_when_given", () => {
  const { rerender } = render(<AppShell user={null}>Content</AppShell>);
  expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  rerender(<AppShell user={null} nav={<a href="/tasks">Tasks</a>}>Content</AppShell>);
  expect(screen.getByRole("navigation", { name: "Sections" })).toBeTruthy();
  rerender(<AppShell user={null} nav={<span>Admin</span>} navLabel="Administration">Content</AppShell>);
  expect(screen.getByRole("navigation", { name: "Administration" })).toBeTruthy();
});
it("skip_link_targets_main", () => { render(<AppShell user={null}>Content</AppShell>); expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe(`#${screen.getByRole("main").id}`); });
it("density_class_on_main", () => {
  const { rerender } = render(<AppShell user={null}>Content</AppShell>); expect(screen.getByRole("main").classList.contains("density-compact")).toBe(true);
  rerender(<AppShell user={null} density="reading">Content</AppShell>); expect(screen.getByRole("main").classList.contains("density-reading")).toBe(true);
});
