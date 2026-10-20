import type { ProjectSummary } from "../api/client";

/**
 * Landing (spec D7): a lead opens Documents of the last project they opened.
 * The key is per user so a shared browser never mixes two people's projects.
 */
export const LAST_PROJECT_PREFIX = "ontocurator.lastProject.v1:";

const leads = (project: ProjectSummary): boolean => project.roles.includes("lead");

export function rememberProject(username: string, key: string): void {
  try {
    window.localStorage.setItem(`${LAST_PROJECT_PREFIX}${username}`, key);
  } catch { /* Storage may be unavailable; landing then falls back to the first led project. */ }
}

export function rememberedProject(username: string): string | null {
  try {
    return window.localStorage.getItem(`${LAST_PROJECT_PREFIX}${username}`);
  } catch {
    return null;
  }
}

/** The remembered project if the user still leads it, else the first led project; undefined for users who lead nothing. */
export function landingProject(username: string, projects: readonly ProjectSummary[]): string | undefined {
  const led = projects.filter(leads);
  const remembered = rememberedProject(username);
  return (led.find(project => project.project_key === remembered) ?? led[0])?.project_key;
}
