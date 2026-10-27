import { useRef, type ReactNode } from "react";
import type { CurrentUser } from "../api/client";
import { personLabel } from "../app/identity";
import { Button } from "./Button";
import { ShortcutHelpHost } from "./ShortcutHelp";

export interface Crumb {
  label: string; onClick?: () => void; href?: string;
  /** Extra detail on hover, e.g. the assignment number behind a named task. */
  title?: string;
}
export interface AppShellProps {
  user: CurrentUser | null;
  onLogout?: () => void;
  breadcrumb?: Crumb[];
  actions?: ReactNode;
  nav?: ReactNode;
  navLabel?: string;
  density?: "reading" | "compact";
  /** Muted second line under the user's identity, e.g. "Lead". */
  role?: string;
  /** The product name links to the user's start page (R-1); `onHome` handles plain clicks in the app. */
  homeHref?: string;
  onHome?: () => void;
  children: ReactNode;
}

export function AppShell({ user, onLogout, breadcrumb, actions, nav, navLabel = "Sections", density = "compact", role, homeHref, onHome, children }: AppShellProps): JSX.Element {
  const mainRef = useRef<HTMLElement>(null);
  const hasNav = nav != null && nav !== false;
  const navigation = hasNav ? <nav className="app-nav" aria-label={navLabel}>{nav}</nav> : null;
  return <div className={`shell${density === "reading" ? " shell-reading" : ""}`}>
    <a className="skip-link" href="#main" onClick={(event) => {
      event.preventDefault();
      mainRef.current?.focus();
    }}>Skip to content</a>
    <header className="app-header shell-header">
      <div className="shell-heading">
        {density === "reading" && hasNav && <details className="shell-reading-navigation" onKeyDown={event => {
          if (event.key !== "Escape" || !event.currentTarget.open) return;
          event.preventDefault();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }}>
          <summary>{navLabel}</summary>
          {navigation}
        </details>}
        {homeHref
          ? <a className="shell-product" href={homeHref} onClick={event => {
            if (!onHome || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onHome();
          }}>Ontotator</a>
          : <span className="shell-product">Ontotator</span>}
        <span className="shell-subtitle">Clinical Curation Workbench</span>
        {!!breadcrumb?.length && <nav aria-label="Breadcrumb"><ol className="shell-breadcrumb">
          {breadcrumb.map((crumb, index) => <li key={index}>
            {index === breadcrumb.length - 1 ? <span aria-current="page" title={crumb.title}>{crumb.label}</span>
              : crumb.onClick ? <Button variant="quiet" size="sm" title={crumb.title} onClick={crumb.onClick}>{crumb.label}</Button>
              : crumb.href ? <a href={crumb.href} title={crumb.title}>{crumb.label}</a> : <span title={crumb.title}>{crumb.label}</span>}
          </li>)}
        </ol></nav>}
      </div>
      <div className="shell-actions">
        {actions}
        {/* Identity (D1): "Display name (pseudonym)"; the username stays out of the shell. */}
        {user && <span className="current-user" data-testid="current-user">
          <span className="current-user-name">{personLabel(user)}</span>
          {role && <span className="cell-secondary">{role}</span>}
        </span>}
        {onLogout && <Button size="sm" onClick={onLogout}>Log out</Button>}
      </div>
    </header>
    <div className="shell-body">
      {density !== "reading" && navigation}
      <main ref={mainRef} id="main" tabIndex={-1} className={`shell-main density-${density}`}>
        {density === "reading" ? children : <div className="shell-page">{children}</div>}
      </main>
    </div>
    <ShortcutHelpHost />
  </div>;
}
