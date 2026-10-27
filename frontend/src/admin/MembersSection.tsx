import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type Member, type MemberCandidate } from "../api/client";
import { Button, Checkbox, ConfirmDialog, DataTable, EmptyState, InlineMessage, TextInput, type Column } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { labelFor, roleLabels, taskLabels } from "../app/labels";
import { personLabel } from "../app/identity";
export interface MembersSectionProps { projectKey: string; isSystemAdmin: boolean }

const roles = ["lead", "annotator", "adjudicator"] as const;

/** M2 M-8d: each role change saves at once and is confirmed in words ("Ana Weber is now Consolidator."). */
export function roleChangeText(name: string, before: readonly string[], after: readonly string[]): string {
  const label = (role: string) => roleLabels[role as typeof roles[number]] ?? role;
  const added = after.filter(role => !before.includes(role)).map(label);
  const removed = before.filter(role => !after.includes(role)).map(label);
  const parts = [added.length && `${name} is now ${added.join(" and ")}.`, removed.length && `${name} is no longer ${removed.join(" and ")}.`].filter(Boolean);
  if (!after.length) return `${name} is no longer a member of this project.`;
  return parts.join(" ") || `${name}'s roles are unchanged.`;
}
type Affected = { id: number; document_id: string; task: string };
type Pending = { username: string; roles: string[]; assignments: Affected[]; fromAdd: boolean };
type Removal = { username: string; name: string; roles: string[]; removed: string };
function affectedAssignments(error: unknown): Affected[] | null {
  if (!(error instanceof ApiError) || error.code !== "MEMBER_HAS_ASSIGNMENTS" || !error.details || typeof error.details !== "object") return null;
  const assignments = error.details.assignments;
  if (!Array.isArray(assignments) || assignments.length === 0 || !assignments.every(item => item && typeof item === "object" && typeof item.id === "number" && typeof item.document_id === "string" && typeof item.task === "string")) return null;
  return assignments as Affected[];
}

export function MembersSection(props: MembersSectionProps): JSX.Element {
  return <MemberEditor key={JSON.stringify([props.projectKey, props.isSystemAdmin])} {...props} />;
}

function MemberEditor({ projectKey, isSystemAdmin }: MembersSectionProps): JSX.Element {
  const id = useId();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [suggestions, setSuggestions] = useState<MemberCandidate[]>([]);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<unknown>();
  const [username, setUsername] = useState("");
  const [newRoles, setNewRoles] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const addButton = useRef<HTMLButtonElement>(null);
  const lifetime = useRef(0);
  const writing = useRef(false);
  useEffect(() => {
    const epoch = ++lifetime.current;
    setMembers(null); setLoadError(undefined);
    void api.listMembers(projectKey).then(rows => { if (epoch === lifetime.current) setMembers(rows); }).catch((failure: unknown) => { if (epoch === lifetime.current) setLoadError(failure); });
    return () => { lifetime.current++; };
  }, [projectKey, isSystemAdmin, retry]);
  const search = useRef(0);
  const typeUsername = (value: string) => {
    setUsername(value);
    const request = ++search.current;
    if (value.trim().length < 3) { setSuggestions([]); return; }
    // Suggestions are a convenience: a failed search leaves the typed username usable.
    void api.listMemberCandidates(projectKey, value.trim()).then(rows => { if (request === search.current) setSuggestions(rows); }).catch(() => { if (request === search.current) setSuggestions([]); });
  };

  const change = async (name: string, wanted: string[], revoke: boolean, fromAdd = false) => {
    if (writing.current || members === null) return;
    const epoch = lifetime.current;
    writing.current = true; setBusy(true); setError(undefined); setConfirmation("");
    const previous = members.find(member => member.username === name);
    try {
      const response = await api.setMemberRoles(projectKey, name, wanted, revoke);
      if (epoch !== lifetime.current) return;
      setConfirmation(roleChangeText(previous?.display_name?.trim() || response.display_name?.trim() || name, previous?.roles ?? [], response.roles));
      setMembers(current => {
        const remaining = (current ?? []).filter(member => member.username !== response.username);
        if (!response.roles.length) return remaining;
        return current?.some(member => member.username === response.username) ? current.map(member => member.username === response.username ? response : member) : [...remaining, response];
      });
      setPending(null); setRemoval(null);
      if (fromAdd) { setUsername(""); setNewRoles([]); setSuggestions([]); }
    } catch (failure: unknown) {
      if (epoch !== lifetime.current) return;
      setRemoval(null);
      const assignments = affectedAssignments(failure);
      if (assignments && !revoke) setPending({ username: name, roles: wanted, assignments, fromAdd });
      else setError(failure);
    } finally { if (epoch === lifetime.current) { writing.current = false; setBusy(false); } }
  };
  const blocked = busy || pending !== null || removal !== null || members === null;
  const closeAdd = () => { setAdding(false); setUsername(""); setNewRoles([]); setSuggestions([]); requestAnimationFrame(() => addButton.current?.focus()); };
  const columns: Column<Member>[] = [
    { id: "person", header: "Person", cell: member => personLabel(member) },
    { id: "username", header: "Username", cell: member => member.username },
    { id: "languages", header: "Languages", cell: member => member.languages.join(", ") || "None" },
    ...roles.map(role => ({ id: role, header: roleLabels[role], cell: (member: Member) => <Checkbox id={`${id}-${member.username}-${role}`} label={<span className="visually-hidden">{member.username}: {roleLabels[role]}</span>} checked={member.roles.includes(role)} disabled={blocked} onChange={event => {
      if (blocked) return;
      if (event.target.checked) { void change(member.username, [...member.roles, role], false); return; }
      // Taking a role away ends the person's sessions, so it is never a silent single click.
      setError(undefined);
      setRemoval({ username: member.username, name: member.display_name?.trim() || member.username || personLabel(member), roles: member.roles.filter(item => item !== role), removed: role });
    }} /> })),
  ];
  return <section aria-label="Members"><h2>Members</h2>
    <p className="field-hint">Role changes save immediately. Leads manage the project, annotators annotate texts and review translations, consolidators merge the annotations of a text.</p>
    {members === null && loadError === undefined && <InlineMessage tone="info">Loading members…</InlineMessage>}
    {loadError !== undefined && <><ErrorNotice error={loadError} /><Button onClick={() => setRetry(value => value + 1)}>Try again</Button></>}
    {members !== null && (members.length ? <DataTable label="Project members" columns={columns} rows={members} rowKey={member => member.username} /> : <EmptyState title="No project members." />)}
    <p role="status" className="settings-confirmation">{confirmation}</p>
    {error !== undefined && !pending && <ErrorNotice error={error} />}
    {!adding ? <Button ref={addButton} onClick={() => setAdding(true)}>Add member…</Button> : <form aria-label="Add member" onSubmit={event => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity() || blocked) return;
      if (!newRoles.length) { setError(new Error("Choose at least one role for the new member.")); return; }
      void change(username, newRoles, false, true);
    }}><fieldset disabled={blocked}><legend>Add member</legend>
      <TextInput id={`${id}-username`} label="Username" hint="Type at least three letters of the name of someone from your projects, or the exact username or e-mail of anyone else." value={username} required autoFocus autoComplete="off" list={`${id}-suggestions`} onChange={event => typeUsername(event.target.value)} />
      <datalist id={`${id}-suggestions`}>{suggestions.map(user => <option key={user.username} value={user.username}>{user.display_name} ({user.username})</option>)}</datalist>
      {roles.map(role => <Checkbox key={role} id={`${id}-new-${role}`} label={roleLabels[role]} aria-label={`New member: ${roleLabels[role]}`} checked={newRoles.includes(role)} onChange={event => setNewRoles(event.target.checked ? [...newRoles, role] : newRoles.filter(item => item !== role))} />)}
      <div className="settings-section-actions">
        <Button type="submit" variant="primary" loading={busy}>Add member</Button>
        <Button onClick={closeAdd}>Close</Button>
      </div>
    </fieldset></form>}
    <ConfirmDialog open={removal !== null} tone="danger" busy={busy}
      title={removal ? (removal.roles.length ? `Remove the ${labelFor(roleLabels, removal.removed)} role from ${removal.name}?` : `Remove ${removal.name} from the project?`) : ""}
      confirmLabel={removal?.roles.length ? "Remove role" : "Remove from project"}
      message={removal && <><p>{removal.roles.length ? `${removal.name} keeps the other roles in this project.` : `${removal.name} loses access to this project.`} This logs {removal.name} out of Ontotator on all devices; they can log in again right away.</p></>}
      onCancel={() => { if (!writing.current) { setRemoval(null); setError(undefined); } }}
      onConfirm={() => { if (removal) void change(removal.username, removal.roles, false); }} />
    <ConfirmDialog open={pending !== null} title="Revoke affected assignments?" busy={busy} confirmLabel="Remove and revoke their open assignments"
      message={pending && <><p>Changing roles for {pending.username} affects these assignments:</p><ul>{pending.assignments.map(assignment => <li key={assignment.id}>{assignment.document_id} — {labelFor(taskLabels, assignment.task)} (assignment {assignment.id})</li>)}</ul>{error !== undefined && <ErrorNotice error={error} />}</>}
      onCancel={() => { if (!writing.current) { setPending(null); setError(undefined); } }}
      onConfirm={() => { if (pending) void change(pending.username, pending.roles, true, pending.fromAdd); }} />
  </section>;
}
