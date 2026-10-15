import type { ReactNode } from "react";
import type { CurrentUser } from "../api/client";
import { Button } from "./Button";
import { ShortcutHelpHost } from "./ShortcutHelp";

export interface Crumb { label: string; onClick?: () => void; href?: string }
export interface AppShellProps {
  user: CurrentUser | null;
  onLogout?: () => void;
  breadcrumb?: Crumb[];
  actions?: ReactNode;
  nav?: ReactNode;
  navLabel?: string;
  density?: "reading" | "compact";
  children: ReactNode;
}

export function AppShell({ user, onLogout, breadcrumb, actions, nav, navLabel = "Sections", density = "compact", children }: AppShellProps): JSX.Element {
  return <div className="shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="app-header shell-header">
      <div className="shell-heading">
        <span className="shell-product">Ontocurator</span>
        {!!breadcrumb?.length && <nav aria-label="Breadcrumb"><ol className="shell-breadcrumb">
          {breadcrumb.map((crumb, index) => <li key={index}>
            {index === breadcrumb.length - 1 ? <span aria-current="page">{crumb.label}</span>
              : crumb.onClick ? <Button variant="quiet" size="sm" onClick={crumb.onClick}>{crumb.label}</Button>
              : crumb.href ? <a href={crumb.href}>{crumb.label}</a> : <span>{crumb.label}</span>}
          </li>)}
        </ol></nav>}
      </div>
      <div className="shell-actions">
        {actions}
        {user && <span className="current-user" data-testid="current-user" title={`Logged in as ${user.username}`}>{user.display_name} · {user.pseudonym}</span>}
        {onLogout && <Button size="sm" onClick={onLogout}>Log out</Button>}
      </div>
    </header>
    <div className="shell-body">
      {nav != null && nav !== false && <nav className="app-nav" aria-label={navLabel}>{nav}</nav>}
      <main id="main" tabIndex={-1} className={`shell-main density-${density}`}>{children}</main>
    </div>
    <ShortcutHelpHost />
  </div>;
}
