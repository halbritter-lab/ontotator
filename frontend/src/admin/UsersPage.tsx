import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { api, ApiError, type AdminUser, type AdminUserPatch, type AuditEvent, type CodeResponse, type CreateUserRequest, type CurrentUser, type ProjectSummary } from "../api/client";
import { Button, Checkbox, ConfirmDialog, DataTable, Dialog, EmptyState, IconMore, InlineMessage, MenuButton, TextInput, Toolbar, type Column, type MenuItem } from "../ui";
import { CodeOnceDialog } from "./CodeOnceDialog";
import { ErrorNotice } from "./ErrorNotice";
import { fieldError } from "./errors";
import { LanguagesField } from "./LanguagesField";
import { formatDateTime, formatShortDateTime, humanize, labelFor, roleLabels, taskLabels } from "../app/labels";

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
  "user.reset_code": "New sign-in code issued",
  "user.password_set": "Password set",
  "user.recovered": "Password recovered offline",
  "user.active": "Activation changed",
  "user.system_admin": "Administrator role changed",
  "user.profile": "Profile changed",
  "user.languages": "Languages changed",
  "user.anonymise": "Personal data erased",
  "project.member_add": "Roles added",
  "project.member_remove": "Roles removed",
  "project.create": "Project created",
  "project.update": "Project settings changed",
  "project.import": "Texts imported",
  "project.export_download": "Export downloaded",
  "project.final_export_requested": "Final export requested",
  "project.final_selection": "Final selection changed",
  "project.translation_review_export": "Translation reviews exported",
  "assignment.create": "Task assigned",
  "assignment.distribute": "Tasks distributed",
  "assignment.language_override": "Language rule overridden",
  "assignment.reassign": "Task reassigned",
  "assignment.reopen": "Task reopened",
  "assignment.revoke": "Task revoked",
  "assignment.unreviewed_translation": "Assigned with an unreviewed translation",
  "guideline.upload": "Guideline uploaded",
  "guideline.withdraw": "Guideline withdrawn",
  "ontology.add": "Ontology added",
  "problem.report": "Problem reported",
  "round.create": "Consolidation round started",
  "text_change.auto_carry": "Text change carried over automatically",
  "text_change.carry": "Text change carried over",
  "text_change.move": "Text change moved",
  "text_change.resolve": "Text change resolved",
  "translation.accept_external_review": "External translation review accepted",
  "translation.correction_requested": "Translation correction requested",
  "translation.lead_correction_started": "Lead correction of a translation started",
  "translation.review": "Translation reviewed",
  "translation.source_reviewed": "Source text reviewed",
  "upload.preview": "Upload checked",
  "variant.discard": "Variant discarded",
  "variant.reanchor": "Variant re-anchored",
  "variant.status_override": "Variant status overridden",
  "work_plan.import": "Work plan imported",
  "work_plan.update": "Work plan changed",
};
const auditValue = (key: string, value: unknown): string =>
  key === "task" && typeof value === "string" ? labelFor(taskLabels, value)
    : Array.isArray(value) ? value.map(item => auditValue(key, item)).join(", ")
      : typeof value === "boolean" ? (value ? "yes" : "no")
        : value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);
/** Plain words for the audit details people need; any other details as "Key: value" text. */
export function auditDetails(event: AuditEvent): string {
  const details = event.details as Record<string, unknown>;
  if (Array.isArray(details.roles)) return details.roles.map(role => labelFor(roleLabels, String(role))).join(", ");
  if (typeof details.active === "boolean") return details.active ? "Activated" : "Deactivated";
  if (typeof details.is_system_admin === "boolean") return details.is_system_admin ? "Granted" : "Withdrawn";
  if (Array.isArray(details.fields)) return details.fields.join(", ");
  if (typeof details.purpose === "string" && Object.keys(details).length === 1) return `${humanize(details.purpose)} code`;
  return Object.entries(details).map(([key, value]) => `${humanize(key)}: ${auditValue(key, value)}`).join("; ");
}
/** "user:lena" is the person; "cli:jan-p" is an operator on the server's command line. */
export function auditActor(actor: string): string {
  const [kind, name] = actor.includes(":") ? [actor.slice(0, actor.indexOf(":")), actor.slice(actor.indexOf(":") + 1)] : ["", actor];
  if (kind === "user") return name;
  if (kind === "cli") return `Command line (${name})`;
  if (kind === "system") return "System";
  if (kind === "recovery") return `Offline recovery (${name})`;
  return actor;
}

const codeLabel = (user: AdminUser) => user.setup_pending ? "New setup code" : "Reset code";

const accessMessage = "Only system administrators can see and manage user accounts. Ask an administrator if someone needs an account or a setup or reset code.";

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
  const [reissue, setReissue] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  // The result of the last (de)activation or anonymisation, shown above the table with its row marked (#47 A-14).
  const [notice, setNotice] = useState<{ username: string; text: string } | null>(null);
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

  // The changed row may move (an anonymised name sorts elsewhere): bring it into view.
  useEffect(() => { if (notice) document.querySelector(".users-row--changed")?.scrollIntoView?.({ block: "nearest" }); }, [notice]);
  const showCode = (issued: CodeResponse, kind: Handover["kind"], username: string) => {
    const value: Handover = { code: issued.code, expires_at: issued.expires_at, kind, username };
    pendingCode.current = value; setCode(value);
  };
  const closeCode = () => { pendingCode.current = null; setCode(null); };
  const replaceUser = (user: AdminUser) => setUsers(rows => rows && (rows.some(row => row.username === user.username) ? rows.map(row => row.username === user.username ? user : row) : [...rows, user]));
  const blocked = busy || loading || users === null || code !== null || confirmation !== null || erase !== null || reissue !== null;
  const pageBlocked = blocked || editing !== null || creating;

  const usernameError = fieldError(createError, ["USERNAME_INVALID", "USERNAME_TAKEN"]);
  const displayNameError = fieldError(createError, ["DISPLAY_NAME_INVALID"]);
  const usernameInput = useRef<HTMLInputElement>(null);
  const displayNameInput = useRef<HTMLInputElement>(null);
  // A refusal about one field moves focus there, where its message is shown.
  // Any other refusal: back to Create user, which was unavailable (and lost focus) while saving (#18).
  const createButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (createError !== undefined) (usernameError ? usernameInput : displayNameError ? displayNameInput : createButton).current?.focus(); }, [createError]); // eslint-disable-line react-hooks/exhaustive-deps
  const createUser = async () => {
    if (writing.current || blocked) return;
    const epoch = lifetime.current;
    writing.current = true; setBusy(true); setCreateError(undefined);
    try {
      const response = await api.adminCreateUser({ ...create, email: create.email?.trim() || null });
      if (epoch !== lifetime.current) return;
      replaceUser(response.user); setCreate(emptyCreate()); setCreating(false); showCode(response, "setup", response.user.username);
    } catch (error: unknown) {
      if (epoch === lifetime.current) setCreateError(error);
    } finally {
      if (epoch === lifetime.current) { writing.current = false; setBusy(false); }
    }
  };
  const issueReset = async (user: AdminUser) => {
    if (writing.current || editing !== null) return;
    const epoch = lifetime.current;
    writing.current = true; setBusy(true); setActionError(undefined);
    try {
      const issued = await api.adminIssueResetCode(user.username);
      // The server issues a setup code to someone who never set a password, as setup_pending reports.
      if (epoch === lifetime.current) { setReissue(null); showCode(issued, user.setup_pending ? "setup" : "reset", user.username); }
    } catch (error: unknown) {
      if (epoch === lifetime.current) { setReissue(null); setActionError(error); }
    } finally {
      if (epoch === lifetime.current) { writing.current = false; setBusy(false); }
    }
  };
  const update = async (username: string, change: AdminUserPatch, fromEdit: boolean) => {
    if (writing.current || pendingCode.current) return;
    const epoch = lifetime.current;
    writing.current = true; setBusy(true); setEditError(undefined); setActionError(undefined); setNotice(null);
    try {
      const user = await api.adminUpdateUser(username, change);
      if (epoch !== lifetime.current) return;
      replaceUser(user); if (fromEdit) setEditing(null);
      if (change.active !== undefined) setNotice({ username, text: `${username} is ${change.active ? "active again" : "deactivated"}.` });
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
  // The renamed row's History button takes the focus back after Anonymise (#18).
  const anonymised = useRef<string | null>(null);
  const anonymise = async () => {
    if (!erase || writing.current) return;
    const epoch = lifetime.current;
    const { username, typed } = erase;
    writing.current = true; setBusy(true); setNotice(null);
    try {
      const user = await api.adminAnonymiseUser(username, typed);
      if (epoch !== lifetime.current) return;
      // The username changes to anonymised-<id>: replace the row by its old name.
      setUsers(rows => rows && rows.map(row => row.username === username ? user : row));
      anonymised.current = user.username;
      setErase(null);
      setNotice({ username: user.username, text: `${username} is now ${user.username}.` });
    } catch (error: unknown) {
      if (epoch === lifetime.current) setErase(current => current && { ...current, error });
    } finally {
      if (epoch === lifetime.current) { writing.current = false; setBusy(false); }
    }
  };
  // The menu cannot be disabled; its actions ignore a choice while the page is blocked.
  const moreActions = (user: AdminUser): MenuItem[] => {
    const act = (run: () => void) => () => { if (!pageBlocked) run(); };
    const items: MenuItem[] = [];
    if (user.active) items.push({ id: "code", label: codeLabel(user), onSelect: act(() => { setActionError(undefined); setReissue(user); }) });
    if (user.username !== currentUser.username) items.push(user.active
      ? { id: "deactivate", label: "Deactivate…", onSelect: act(() => setConfirmation({ username: user.username, change: { active: false }, kind: "deactivate", fromEdit: false })) }
      : { id: "activate", label: "Activate", description: "Needed before a new code can be issued.", onSelect: act(() => { void update(user.username, { active: true }, false); }) });
    items.push({ id: "history", label: "History", onSelect: act(() => { void showHistory(user.username); }) });
    if (!user.active) items.push({ id: "anonymise", label: "Anonymise…", onSelect: act(() => { anonymised.current = null; setErase({ username: user.username, typed: "" }); }) });
    return items;
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
    { id: "last-login", header: "Last login", cell: user => user.last_login_at ? <time dateTime={user.last_login_at} title={formatDateTime(user.last_login_at)}>{formatShortDateTime(user.last_login_at)}</time> : "Never", sortValue: user => user.last_login_at ?? "" },
    { id: "actions", header: "Actions", cell: user => user.anonymised ? <Toolbar label={`Actions for ${user.username}`}>
      <Button size="sm" disabled={pageBlocked} aria-label={`History of ${user.username}`} onClick={() => { void showHistory(user.username); }}>History</Button>
    </Toolbar> : <Toolbar label={`Actions for ${user.username}`}>
      <Button size="sm" disabled={pageBlocked} aria-label={`Edit ${user.username}`} onClick={() => { setEditError(undefined); setEditing({ baseline: user, draft: { ...user, languages: [...user.languages] } }); }}>Edit</Button>
      <MenuButton label={`More actions for ${user.username}`} buttonLabel="More…" icon={<IconMore />} items={moreActions(user)} />
    </Toolbar> },
  ];
  const query = filter.trim().toLowerCase();
  if (loadError instanceof ApiError && loadError.status === 403) return <section className="detail-section"><h1>Users</h1><InlineMessage tone="info">{accessMessage}</InlineMessage></section>;
  return <div className="users-page density-compact">
    <section className="detail-section">
      <h1>Users</h1>
      <Toolbar label="Users actions">
        <TextInput id="users-filter" label="Filter users" value={filter} onChange={event => setFilter(event.target.value)} />
        <Button variant="primary" disabled={pageBlocked} onClick={() => { setCreateError(undefined); setCreating(true); }}>New user…</Button>
        <Button disabled={busy || loading || !!code || !!confirmation || !!editing || creating} onClick={() => { void refresh(lifetime.current); }}>Refresh users</Button>
      </Toolbar>
      {loading && <InlineMessage tone="info">Loading users…</InlineMessage>}
      {loadError !== undefined && <ErrorNotice error={loadError} />}
      {actionError !== undefined && <ErrorNotice error={actionError} />}
      {notice && <InlineMessage tone="success" onDismiss={() => setNotice(null)}>{notice.text}</InlineMessage>}
      {users !== null && <DataTable label="Users" className="data-table--pin-end" columns={columns}
        rowProps={user => user.username === notice?.username ? { className: "users-row--changed" } : {}} rows={users.filter(user => user.username.toLowerCase().includes(query) || user.display_name.toLowerCase().includes(query))} rowKey={user => user.username} empty={<EmptyState title={query ? "No matching users." : "No users to display."} />} />}
    </section>
    {creating && <Dialog open title="New user" onClose={busy ? undefined : () => setCreating(false)}>
      <form aria-label="New user" onSubmit={event => { event.preventDefault(); void createUser(); }}>
        <TextInput ref={usernameInput} id="new-username" label="Username" error={usernameError} required minLength={3} maxLength={64} value={create.username} disabled={blocked} onChange={event => { setCreateError(undefined); setCreate({ ...create, username: event.target.value }); }} />
        <TextInput ref={displayNameInput} id="new-name" label="Display name" error={displayNameError} required maxLength={120} value={create.display_name} disabled={blocked} onChange={event => { setCreateError(undefined); setCreate({ ...create, display_name: event.target.value }); }} />
        <TextInput id="new-email" label="E-mail" type="email" value={create.email ?? ""} disabled={blocked} onChange={event => setCreate({ ...create, email: event.target.value })} />
        <LanguagesField id="new-languages" label="Languages" value={create.languages ?? []} disabled={blocked} onChange={languages => setCreate({ ...create, languages })} />
        <Checkbox id="new-admin" label="System administrator" checked={create.system_admin} disabled={blocked} onChange={event => setCreate({ ...create, system_admin: event.target.checked })} />
        {projects.length > 0 && <fieldset className="new-user-projects" disabled={blocked}><legend>Add to projects (optional)</legend>
          {/* One grid: the role names head the columns once; each checkbox keeps "Project: Role" as its name. */}
          <div className="new-user-projects-row" aria-hidden="true"><span />{projectRoles.map(role => <span key={role}>{roleLabels[role]}</span>)}</div>
          {projects.map(project => <div key={project.project_key} className="new-user-projects-row" role="group" aria-label={project.name}>
            <span>{project.name}</span>
            {projectRoles.map(role => <Checkbox key={role} id={`new-${project.project_key}-${role}`} label={<span className="visually-hidden">{roleLabels[role]}</span>} aria-label={`${project.name}: ${roleLabels[role]}`} checked={roleFor(project.project_key).includes(role)} onChange={event => toggleNewRole(project.project_key, role, event.target.checked)} />)}
          </div>)}
        </fieldset>}
        {createError !== undefined && !usernameError && !displayNameError && <ErrorNotice error={createError} />}
        <Toolbar label="New user actions"><Button disabled={busy} onClick={() => setCreating(false)}>Cancel</Button><Button ref={createButton} type="submit" variant="primary" disabled={blocked}>Create user</Button></Toolbar>
      </form>
    </Dialog>}
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
    {reissue && <ConfirmDialog open title={`Issue a new ${reissue.setup_pending ? "setup" : "reset"} code for ${reissue.display_name || reissue.username}?`} message={reissue.setup_pending ? "The current setup code stops working." : "Any unused code stops working. The current password keeps working until the new code is used."} confirmLabel={codeLabel(reissue)} busy={busy} onCancel={() => setReissue(null)} onConfirm={() => { void issueReset(reissue); }} />}
    {code && <CodeOnceDialog open {...code} onClose={closeCode} />}
    {history && <Dialog open title={`History of ${history.username}`} size="lg" className="audit-history-dialog" onClose={() => setHistory(null)} closeOnBackdrop>
      {history.events === null ? <InlineMessage tone="info">Loading history…</InlineMessage> : history.error !== undefined ? <ErrorNotice error={history.error} /> :
        <DataTable label="History" rows={history.events} rowKey={event => `${event.at}-${event.action}-${event.target_id}-${JSON.stringify(event.details)}`} empty={<EmptyState title="No recorded changes." />} columns={[
          { id: "at", header: "When", cell: event => <time className="audit-when" dateTime={event.at} title={formatDateTime(event.at)}>{formatShortDateTime(event.at)}</time> },
          { id: "actor", header: "By", cell: event => auditActor(event.actor) },
          { id: "action", header: "What", cell: event => labelFor(auditActions, event.action) },
          { id: "target", header: "Whom", cell: event => event.target_type === "user" ? event.target_id : `${humanize(event.target_type)} ${event.target_id}` },
          { id: "project", header: "Project", cell: event => event.project_key ?? "" },
          { id: "details", header: "Details", cell: auditDetails },
        ]} />}
      <p className="field-hint">Newest first, at most 200 entries. The CLI command <code>ontotator admin audit</code> exports the whole trail.</p>
    </Dialog>}
    {erase && <Dialog open title={`Anonymise ${erase.username}`} size="sm" onClose={busy ? undefined : () => setErase(null)}
      returnFocus={() => anonymised.current === null ? null : [...document.querySelectorAll<HTMLElement>("button[aria-label]")].find(button => button.getAttribute("aria-label") === `History of ${anonymised.current}`)}
      footer={<><Button disabled={busy} onClick={() => setErase(null)}>Cancel</Button><Button variant="danger" loading={busy} disabled={erase.typed.trim().toLowerCase() !== erase.username} onClick={() => { void anonymise(); }}>Anonymise permanently</Button></>}>
      <p>This erases the person's name, e-mail, ORCID, qualification, languages, preferences and password, their codes and the addresses of their past logins, and replaces their username with an anonymous one everywhere it is recorded, including the history. It cannot be undone.</p>
      <p>Their pseudonym and all their work stay, so annotations, results and exports remain complete.</p>
      <TextInput id="erase-confirm" label={`Type ${erase.username} to confirm`} value={erase.typed} autoComplete="off" disabled={busy} onChange={event => setErase({ ...erase, typed: event.target.value, error: undefined })} />
      {erase.error !== undefined && <ErrorNotice error={erase.error} />}
    </Dialog>}
  </div>;
}
