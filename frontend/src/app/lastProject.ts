import type { ProjectSummary } from "../api/client";

/**
 * Last-used landing (spec F8, D4): after login every user returns to the project they used last
 * (Documents for leads, My tasks filtered to it for everyone else); without one, or when it is no
 * longer accessible, the Projects page for a lead of any project and My tasks otherwise. "Used" means a project route (`key`), My tasks with
 * `?project=` or an opened task of that project. The key is per user so a shared browser never
 * mixes two people's projects.
 */
export const LAST_PROJECT_PREFIX = "ontotator.lastProject.v1:";

export function rememberProject(username: string, key: string): void {
  try {
    window.localStorage.setItem(`${LAST_PROJECT_PREFIX}${username}`, key);
  } catch { /* Storage may be unavailable; the landing then uses the fallback. */ }
}

export function rememberedProject(username: string): string | null {
  try {
    return window.localStorage.getItem(`${LAST_PROJECT_PREFIX}${username}`);
  } catch {
    return null;
  }
}

/** The remembered project while it is still in `projects` (any role), else undefined. */
export function landingProject(username: string, projects: readonly ProjectSummary[]): string | undefined {
  const remembered = rememberedProject(username);
  return projects.find(project => project.project_key === remembered)?.project_key;
}
