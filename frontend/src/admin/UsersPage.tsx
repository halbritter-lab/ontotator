import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { api, ApiError, type AdminUser, type AdminUserPatch, type AuditEvent, type CodeResponse, type CreateUserRequest, type CurrentUser, type ProjectSummary } from "../api/client";
import { Button, Checkbox, ConfirmDialog, DataTable, Dialog, EmptyState, InlineMessage, TextInput, Toolbar, type Column } from "../ui";
import { CodeOnceDialog } from "./CodeOnceDialog";
import { ErrorNotice } from "./ErrorNotice";
import { LanguagesField } from "./LanguagesField";
import { formatDateTime, labelFor, roleLabels } from "../app/labels";

export interface UsersPageProps {
  currentUser: CurrentUser;
  /** App must consult this before shell/hash/history navigation or logout. */
  routeLeaveRef?: MutableRefObject<(() => Promise<boolean>) | null>;
}
type Handover = CodeResponse & { kind: "setup" | "reset"; username: string };
type PendingChange = { username: string; change: AdminUserPatch; kind: "admin" | "deactivate"; fromEdit: boolean };
type EditState = { baseline: AdminUser; draft: AdminUser };
const emptyCreate = (): CreateUserRequest => ({ username: "", display_name: "", email: "", languages: [], system_admin: false, projects: [] });
const projectRoles = ["lead", "annotator", "adjudicator"] as const;
type History = { username: string; events: AuditEvent[] | null; error?: unknown };

const auditActions: Readonly<Record<string, string>> = {
  "user.bootstrap": "First administrator created",
  "user.create": "Account created",
  "user.reset_code": "Reset code issued",
  "user.password_set": "Password set",
  "user.recovered": "Password recovered offline",
  "user.active": "Activation changed",
  "user.system_admin": "Administrator role changed",
  "user.profile": "Profile changed",
  "user.languages": "Languages changed",
  "user.anonymise": "Personal data erased",
  "project.member_add": "Roles added",
  "project.member_remove": "Roles removed",
};
/** Plain words for the audit details people need; other details as compact JSON. */
export function auditDetails(event: AuditEvent): string {
  const details = event.details as Record<string, unknown>;
  if (Array.isArray(details.roles)) return details.roles.map(role => labelFor(roleLabels, String(role))).join(", ");
  if (typeof details.active === "boolean") return details.active ? "Activated" : "Deactivated";
  if (typeof details.is_system_admin === "boolean") return details.is_system_admin ? "Granted" : "Withdrawn";
  if (Array.isArray(details.fields)) return details.fields.join(", ");
  return Object.keys(details).length ? JSON.stringify(details) : "";
}

const accessMessage = "Only system administrators can see and manage user accounts. Ask an administrator if someone needs an account or a new sign-in code.";

export function UsersPage(props: UsersPageProps): JSX.Element {
  if (!props.currentUser.is_system_admin) return <section className="detail-section"><h1>Users</h1><InlineMessage tone="info">{accessMessage}</InlineMessage></section>;
  return <UsersContent {...props} />;
}

function UsersContent({ currentUser, routeLeaveRef }: UsersPageProps): JSX.Element {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>();
  const [filter, setFilter] = useState("");
  const [create, setCreate] = useState<CreateUserRequest>(emptyCreate);
  const [createError, setCreateError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editError, setEditError] = useState<unknown>();
  const [confirmation, setConfirmation] = useState<PendingChange | null>(null);
  const [code, setCode] = useState<Handover | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [history, setHistory] = useState<History | null>(null);
  const [erase, setErase] = useState<{ username: string; typed: string; error?: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const lifetime = useRef(0);
  const generation = useRef(0);
  const writing = useRef(false);
  const pendingCode = useRef<Handover | null>(null);

  const refresh = async (epoch: number) => {
    const request = ++generation.current;
    setLoading(true); setLoadError(undefined);
    try {
      const rows = await api.adminListUsers();
      if (epoch === lifetime.current && request === generation.current) setUsers(rows);
    } catch (error: unknown) {
      if (epoch === lifetime.current && request === generation.current) setLoadError(error);
    } finally {
      if (epoch === lifetime.current && request === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    const epoch = ++lifetime.current;
    void refresh(epoch);
    // The picker in "New user" is optional: without the project list it is simply not shown.
    void api.listProjects().then(rows => { if (epoch === lifetime.current) setProjects(rows); }).catch(() => undefined);
    return () => { lifetime.current++; generation.current++; };
  }, []);
  useEffect(() => {
    if (!routeLeaveRef) return;
    // The child owns acknowledgement. Keep visible or still-pending secrets
    // until the reviewed dialog's acknowledged Close completes the handover.
    const guard = async () => !writing.current && pendingCode.current === null;
    routeLeaveRef.current = guard;
    return () => { if (routeLeaveRef.current === guard) routeLeaveRef.current = null; };
  }, [routeLeaveRef]);

  const showCode = (issued: CodeResponse, kind: Handover["kind"], username: string) => {
    const value: Handover = { code: issued.code, expires_at: issued.expires_at, kind, username };
    pendingCode.current = value; setCode(value);
  };
  const closeCode = () => { pendingCode.current = null; setCode(null); };
  const replaceUser = (user: AdminUser) => setUsers(rows => rows && (rows.some(row => row.username === user.username) ? rows.map(row => row.username === user.username ? user : row) : [...rows, user]));
  const blocked = busy || loading || users === null || code !== null || confirmation !== null || erase !== null;
  const pageBlocked = blocked || editing !== null;

  const createUser = async () => {
    if (writing.current || blocked) return;
    const epoch = lifetime.current;
    writing.current = true; setBusy(true); setCreateError(undefined);
    try {
      const response = await api.adminCreateUser({ ...create, email: create.email?.trim() || null });
      if (epoch !== lifetime.current) return;
      replaceUser(response.user); setCreate(emptyCreate()); showCode(response, "setup", response.user.username);
    } catch (error: unknown) {
      if (epoch === lifetime.current) setCreateError(error);
    } finally {
      if (epoch === lifetime.current) { writing.current = false; setBusy(false); }
    }
  };
  const issueReset = async (username: string) => {
    if (writing.current || pageBlocked) return;
    const epoch = lifetime.current;
    writing.current = true; setBusy(true); setActionError(undefined);
    try {
      const issued = await api.adminIssueResetCode(username);
      if (epoch === lifetime.current) showCode(issued, "reset", username);
    } catch (error: unknown) {
      if (epoch === lifetime.current) setActionError(error);
    } finally {
      if (epoch === lifetime.current) { writing.current = false; setBusy(false); }
    }
  };
  const update = async (username: string, change: AdminUserPatch, fromEdit: boolean) => {
    if (writing.current || pendingCode.current) return;
    const epoch = lifetime.current;
    writing.current = true; setBusy(true); setEditError(undefined); setActionError(undefined);
    try {
      const user = await api.adminUpdateUser(username, change);
      if (epoch !== lifetime.current) return;
      replaceUser(user); if (fromEdit) setEditing(null);
    } catch (error: unknown) {
      if (epoch === lifetime.current) { if (fromEdit) setEditError(error); else setActionError(error); }
    } finally {
      if (epoch === lifetime.current) { setConfirmation(null); writing.current = false; setBusy(false); }
    }
  };
  const saveEdit = () => {
    if (!editing || writing.current || confirmation) return;
    const { baseline, draft } = editing;
    const change: AdminUserPatch = {};
    if (draft.display_name !== baseline.display_name) change.display_name = draft.display_name;
    const email = draft.email?.trim() || null;
    if (email !== baseline.email) change.email = email;
    const qualification = draft.qualification?.trim() || null;
    if (qualification !== baseline.qualification) change.qualification = qualification;
    if (JSON.stringify([...draft.languages].sort()) !== JSON.stringify([...baseline.languages].sort())) change.languages = draft.languages;
    if (draft.is_system_admin !== baseline.is_system_admin) change.is_system_admin = draft.is_system_admin;
    if (!Object.keys(change).length) { setEditing(null); return; }
    if (change.is_system_admin !== undefined) setConfirmation({ username: baseline.username, change, kind: "admin", fromEdit: true });
    else void update(baseline.username, change, true);
  };
  const showHistory = async (username: string) => {
    const epoch = lifetime.current;
    setHistory({ username, events: null });
    try {
      const events = await api.adminUserAudit(username);
      if (epoch === lifetime.current) setHistory(current => current?.username === username ? { username, events } : current);
    } catch (error: unknown) {
      if (epoch === lifetime.current) setHistory(current => current?.username === username ? { username, events: [], error } : current);
    }
  };
  const anonymise = async () => {
    if (!erase || writing.current) return;
    const epoch = lifetime.current;
    const { username, typed } = erase;
    writing.current = true; setBusy(true);
    try {
      const user = await api.adminAnonymiseUser(username, typed);
      if (epoch !== lifetime.current) return;
      // The username changes to anonymised-<id>: replace the row by its old name.
      setUsers(rows => rows && rows.map(row => row.username === username ? user : row));
      setErase(null);
    } catch (error: unknown) {
      if (epoch === lifetime.current) setErase(current => current && { ...current, error });
    } finally {
      if (epoch === lifetime.current) { writing.current = false; setBusy(false); }
    }
  };
  const roleFor = (key: string) => create.projects?.find(item => item.project_key === key)?.roles ?? [];
  const toggleNewRole = (key: string, role: string, on: boolean) => {
    const roles = on ? [...roleFor(key), role] : roleFor(key).filter(item => item !== role);
    const others = (create.projects ?? []).filter(item => item.project_key !== key);
    setCreate({ ...create, projects: roles.length ? [...others, { project_key: key, roles }] : others });
  };
  const edit = (change: Partial<AdminUser>) => { setEditError(undefined); setEditing(value => value && { ...value, draft: { ...value.draft, ...change } }); };

  const columns: Column<AdminUser>[] = [
    { id: "username", header: "Username", cell: user => user.username, sortValue: user => user.username },
    { id: "name", header: "Display name", cell: user => user.display_name },
    { id: "pseudonym", header: "Pseudonym", cell: user => user.pseudonym },
    { id: "languages", header: "Languages", cell: user => user.languages.join(", ") || "None" },
    { id: "projects", header: "Projects", cell: user => user.projects.length ? <ul>{user.projects.map(project => <li key={project.project_key} title={project.project_key}>{project.project_name || project.project_key}: {project.roles.map(role => labelFor(roleLabels, role)).join(", ")}</li>)}</ul> : "None" },
    { id: "admin", header: "Admin", cell: user => user.is_system_admin ? "Yes" : "No" },
    { id: "active", header: "Active", cell: user => user.anonymised ? "Anonymised" : user.active ? "Yes" : "No" },
    { id: "setup", header: "Setup", cell: user => user.setup_pending ? "Pending" : user.anonymised ? "–" : "Done", sortValue: user => user.setup_pending ? 0 : 1 },
    { id: "last-login", header: "Last login", cell: user => user.last_login_at ? <time dateTime={user.last_login_at}>{formatDateTime(user.last_login_at)}</time> : "Never", sortValue: user => user.last_login_at ?? "" },
    { id: "actions", header: "Actions", cell: user => user.anonymised ? <Toolbar label={`Actions for ${user.username}`}>
      <Button size="sm" disabled={pageBlocked} aria-label={`History of ${user.username}`} onClick={() => { void showHistory(user.username); }}>History</Button>
    </Toolbar> : <Toolbar label={`Actions for ${user.username}`}>
      <Button size="sm" disabled={pageBlocked || !user.active} title={user.active ? undefined : "Activate the account before issuing a reset code."} aria-label={`Reset code for ${user.username}`} onClick={() => { void issueReset(user.username); }}>Reset code</Button>
      <Button size="sm" disabled={pageBlocked} aria-label={`Edit ${user.username}`} onClick={() => { setEditError(undefined); setEditing({ baseline: user, draft: { ...user, languages: [...user.languages] } }); }}>Edit</Button>
      <Button size="sm" variant={user.active ? "danger" : "secondary"} disabled={pageBlocked || user.username === currentUser.username} title={user.username === currentUser.username ? "You cannot deactivate yourself." : undefined} aria-label={`${user.active ? "Deactivate" : "Activate"} ${user.username}`} onClick={() => {
        if (user.active) setConfirmation({ username: user.username, change: { active: false }, kind: "deactivate", fromEdit: false });
        else void update(user.username, { active: true }, false);
      }}>{user.active ? "Deactivate" : "Activate"}</Button>
      <Button size="sm" disabled={pageBlocked} aria-label={`History of ${user.username}`} onClick={() => { void showHistory(user.username); }}>History</Button>
      {!user.active && <Button size="sm" variant="danger" disabled={pageBlocked} aria-label={`Anonymise ${user.username}`} onClick={() => setErase({ username: user.username, typed: "" })}>Anonymise…</Button>}
    </Toolbar> },
  ];
  const query = filter.trim().toLowerCase();
  if (loadError instanceof ApiError && loadError.status === 403) return <section className="detail-section"><h1>Users</h1><InlineMessage tone="info">{accessMessage}</InlineMessage></section>;
  return <div className="density-compact">
    <section className="detail-section">
      <h1>Users</h1>
      <TextInput id="users-filter" label="Filter users" value={filter} onChange={event => setFilter(event.target.value)} />
      <Toolbar label="Users actions"><Button disabled={busy || loading || !!code || !!confirmation || !!editing} onClick={() => { void refresh(lifetime.current); }}>Refresh users</Button></Toolbar>
      {loading && <InlineMessage tone="info">Loading users…</InlineMessage>}
      {loadError !== undefined && <ErrorNotice error={loadError} />}
      {actionError !== undefined && <ErrorNotice error={actionError} />}
      {users !== null && <DataTable label="Users" columns={columns} rows={users.filter(user => user.username.toLowerCase().includes(query) || user.display_name.toLowerCase().includes(query))} rowKey={user => user.username} empty={<EmptyState title={query ? "No matching users." : "No users to display."} />} />}
    </section>
    <section className="detail-section">
      <h2>New user</h2>
      <form aria-label="New user" onSubmit={event => { event.preventDefault(); void createUser(); }}>
        <TextInput id="new-username" label="Username" required minLength={3} maxLength={64} value={create.username} disabled={pageBlocked} onChange={event => { setCreateError(undefined); setCreate({ ...create, username: event.target.value }); }} />
        <TextInput id="new-name" label="Display name" required maxLength={120} value={create.display_name} disabled={pageBlocked} onChange={event => { setCreateError(undefined); setCreate({ ...create, display_name: event.target.value }); }} />
        <TextInput id="new-email" label="E-mail" type="email" value={create.email ?? ""} disabled={pageBlocked} onChange={event => setCreate({ ...create, email: event.target.value })} />
        <LanguagesField id="new-languages" label="Languages" value={create.languages ?? []} disabled={pageBlocked} onChange={languages => setCreate({ ...create, languages })} />
        <Checkbox id="new-admin" label="System administrator" checked={create.system_admin} disabled={pageBlocked} onChange={event => setCreate({ ...create, system_admin: event.target.checked })} />
        {projects.length > 0 && <fieldset className="new-user-projects" disabled={pageBlocked}><legend>Add to projects (optional)</legend>
          {projects.map(project => <div key={project.project_key} role="group" aria-label={project.name}>
            <span>{project.name}</span>
            {projectRoles.map(role => <Checkbox key={role} id={`new-${project.project_key}-${role}`} label={roleLabels[role]} aria-label={`${project.name}: ${roleLabels[role]}`} checked={roleFor(project.project_key).includes(role)} onChange={event => toggleNewRole(project.project_key, role, event.target.checked)} />)}
          </div>)}
        </fieldset>}
        {createError !== undefined && <ErrorNotice error={createError} />}
        <Button type="submit" variant="primary" disabled={pageBlocked}>Create user</Button>
      </form>
    </section>
    {editing && <Dialog open title={`Edit ${editing.baseline.username}`} onClose={busy || confirmation ? undefined : () => setEditing(null)}>
      <form aria-label="Edit user" onSubmit={event => { event.preventDefault(); saveEdit(); }}>
        <TextInput id="edit-name" label="Display name" required maxLength={120} value={editing.draft.display_name} disabled={busy || !!confirmation} onChange={event => edit({ display_name: event.target.value })} />
        <TextInput id="edit-email" label="E-mail" type="email" value={editing.draft.email ?? ""} disabled={busy || !!confirmation} onChange={event => edit({ email: event.target.value })} />
        <TextInput id="edit-qualification" label="Qualification" maxLength={200} hint="e.g. physician, native German speaker" value={editing.draft.qualification ?? ""} disabled={busy || !!confirmation} onChange={event => edit({ qualification: event.target.value })} />
        <LanguagesField id="edit-languages" label="Languages" value={editing.draft.languages} disabled={busy || !!confirmation} onChange={languages => edit({ languages })} />
        <Checkbox id="edit-admin" label="System administrator" checked={editing.draft.is_system_admin} disabled={busy || !!confirmation || editing.baseline.username === currentUser.username} title={editing.baseline.username === currentUser.username ? "You cannot remove your own administrator role." : undefined} onChange={event => edit({ is_system_admin: event.target.checked })} />
        {editError !== undefined && <ErrorNotice error={editError} />}
        <Toolbar label="Edit actions"><Button disabled={busy || !!confirmation} onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !!confirmation}>Save changes</Button></Toolbar>
      </form>
    </Dialog>}
    {confirmation && <ConfirmDialog open title={confirmation.kind === "admin" ? "Change administrator role" : `Deactivate ${confirmation.username}`} message="This logs the user out everywhere." confirmLabel={confirmation.kind === "admin" ? "Save changes" : "Deactivate"} tone={confirmation.kind === "deactivate" ? "danger" : "primary"} busy={busy} onCancel={() => setConfirmation(null)} onConfirm={() => { void update(confirmation.username, confirmation.change, confirmation.fromEdit); }} />}
    {code && <CodeOnceDialog open {...code} onClose={closeCode} />}
    {history && <Dialog open title={`History of ${history.username}`} size="lg" onClose={() => setHistory(null)} closeOnBackdrop>
      {history.events === null ? <InlineMessage tone="info">Loading history…</InlineMessage> : history.error !== undefined ? <ErrorNotice error={history.error} /> :
        <DataTable label="History" rows={history.events} rowKey={event => `${event.at}-${event.action}-${event.target_id}-${JSON.stringify(event.details)}`} empty={<EmptyState title="No recorded changes." />} columns={[
          { id: "at", header: "When", cell: event => <time dateTime={event.at}>{formatDateTime(event.at)}</time> },
          { id: "actor", header: "By", cell: event => event.actor },
          { id: "action", header: "What", cell: event => labelFor(auditActions, event.action) },
          { id: "target", header: "Whom", cell: event => event.target_id },
          { id: "project", header: "Project", cell: event => event.project_key ?? "" },
          { id: "details", header: "Details", cell: auditDetails },
        ]} />}
      <p className="field-hint">Newest first, at most 200 entries. The CLI command <code>ontocurator admin audit</code> exports the whole trail.</p>
    </Dialog>}
    {erase && <Dialog open title={`Anonymise ${erase.username}`} size="sm" onClose={busy ? undefined : () => setErase(null)}
      footer={<><Button disabled={busy} onClick={() => setErase(null)}>Cancel</Button><Button variant="danger" loading={busy} disabled={erase.typed.trim().toLowerCase() !== erase.username} onClick={() => { void anonymise(); }}>Anonymise permanently</Button></>}>
      <p>This erases the person's name, e-mail, ORCID, qualification, languages and password, and the addresses of their past logins. It cannot be undone.</p>
      <p>Their pseudonym and all their work stay, so annotations, results and exports remain complete.</p>
      <TextInput id="erase-confirm" label={`Type ${erase.username} to confirm`} value={erase.typed} autoComplete="off" disabled={busy} onChange={event => setErase({ ...erase, typed: event.target.value, error: undefined })} />
      {erase.error !== undefined && <ErrorNotice error={erase.error} />}
    </Dialog>}
  </div>;
}
